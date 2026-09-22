import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser,
  isJidGroup,
  Browsers,
} from 'baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from './config.js';
import { installSendGuard } from './guard.js';
import { silenceSignalKeyDumps } from './quiet.js';

// يُركَّب عند تحميل الوحدة: كل نقاط الدخول تتصل بواتساب عبرها
silenceSignalKeyDumps();

const logger = pino({ level: 'silent' });

/** يفكّ أغلفة الرسائل (المؤقتة/مرة واحدة/المعدّلة) للوصول للمحتوى الحقيقي. */
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    else if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    else if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    else if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    else if (m.editedMessage) m = m.editedMessage.message;
    else break;
  }
  return m;
}

/** يستخرج النص من الرسالة، ويصف المرفقات التي لا نص لها. */
function extractText(message) {
  const m = unwrap(message);
  if (!m) return null;

  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null;

  if (text) return text;

  // مرفقات بلا نص: نسجّلها كوصف مختصر — قد يكون الطلب في الملف نفسه.
  if (m.documentMessage) return `[ملف: ${m.documentMessage.fileName || 'مرفق'}]`;
  if (m.imageMessage) return '[صورة بدون تعليق]';
  if (m.audioMessage) return '[رسالة صوتية]';
  return null;
}

function contextOf(message) {
  const m = unwrap(message);
  return m?.extendedTextMessage?.contextInfo || m?.imageMessage?.contextInfo || null;
}

/**
 * إيقاف العملية أثناء كتابة creds.json يتركه مبتورًا أو فارغًا، فتبدأ
 * الجلسة من الصفر وتطلب رمز QR بلا تفسير. نكشف ذلك ونقوله صراحة.
 */
function assertAuthNotCorrupt() {
  const credsPath = path.join(config.authDir, 'creds.json');
  if (!fs.existsSync(credsPath)) return; // أول تشغيل — طبيعي

  const { size } = fs.statSync(credsPath);
  let valid = size > 0;
  if (valid) {
    try {
      JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    } catch {
      valid = false;
    }
  }
  if (valid) return;

  console.error(
    '\n❌ ملف جلسة واتساب تالف (creds.json فارغ أو غير صالح).\n' +
      '   يحدث هذا إذا أُوقفت العملية بالقوة أثناء حفظ الجلسة.\n' +
      '   الحل — احذف الجلسة وأعد الربط مرة واحدة:\n\n' +
      '     rm -rf data/wa-auth && npm run login\n',
  );
  process.exit(1);
}

export class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.selfJid = null;
    this.status = 'starting';
    this.lastQr = null;
    this.groupNames = new Map();
  }

  async start() {
    fs.mkdirSync(config.authDir, { recursive: true });
    assertAuthNotCorrupt();
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false, // يبقى جوالك هو "المتصل" ولا يسرق الإشعارات
      syncFullHistory: false,
      getMessage: async () => undefined,
    });

    // يُركَّب قبل أي مستمع أحداث: من هذه اللحظة لا يمكن لأي شيفرة
    // — حالية أو مستقبلية — أن ترسل إلى قروب أو إلى أي شخص آخر.
    installSendGuard(this.sock, () => this.selfJid, config.digestGroupJid || null);
    console.log(
      config.digestGroupJid
        ? `🔒 حارس الإرسال مفعّل: المسموح محادثتك مع نفسك + قروب واحد (${config.digestGroupJid}). كل ما عداه ممنوع.`
        : '🔒 حارس الإرسال مفعّل: القروبات والأشخاص محظورون، والمسموح محادثتك مع نفسك فقط.',
    );

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (u) => this.#onConnection(u));
    this.sock.ev.on('messages.upsert', (u) => this.#onMessages(u));

    // اسم القروب مخزّن مؤقتًا؛ بدون هذا يبقى الاسم القديم حتى إعادة التشغيل
    this.sock.ev.on('groups.update', (updates) => {
      for (const g of updates) {
        if (g.id && g.subject) {
          this.groupNames.set(g.id, g.subject);
          console.log(`✏️  تغيّر اسم القروب إلى: ${g.subject}`);
        }
      }
    });
    return this;
  }

  #onConnection(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.lastQr = qr;
      this.status = 'waiting-qr';
      console.log('\n📱 امسح رمز QR من واتساب ← الإعدادات ← الأجهزة المرتبطة:\n');
      qrcode.generate(qr, { small: true });
      this.emit('qr', qr);
    }

    if (connection === 'open') {
      this.status = 'connected';
      this.lastQr = null;
      this.selfJid = jidNormalizedUser(this.sock.user?.id);
      console.log(`✅ متصل بواتساب باسم: ${this.sock.user?.name || this.selfJid}`);
      this.emit('ready', this.selfJid);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        this.status = 'logged-out';
        console.error(
          '\n❌ تم تسجيل الخروج من واتساب. احذف مجلد data/wa-auth ثم شغّل npm run login من جديد.',
        );
        this.emit('logged-out');
        return;
      }

      // 440: جلسة أخرى بنفس الاعتماد أزاحت هذه. إعادة الاتصال هنا تُنتج
      // حلقة لا تنتهي: كل نسخة تزيح الأخرى فتعيد الأخرى الاتصال فتزيحها.
      // نخرج بدل أن نتقاتل، ونقول السبب.
      if (code === DisconnectReason.connectionReplaced) {
        this.status = 'replaced';
        console.error(
          '\n❌ جلسة أخرى أزاحت هذه الجلسة (440).\n' +
            '   غالبًا نسخة ثانية من البوت تعمل في طرفية أخرى.\n' +
            '   أوقفها ثم شغّل هذه وحدها:\n\n' +
            '     pkill -f "node src/index.js"\n',
        );
        this.emit('replaced');
        return;
      }

      console.warn(`⚠️  انقطع الاتصال (${code}) — إعادة محاولة بعد 3 ثوانٍ...`);
      setTimeout(() => this.start().catch((e) => console.error(e)), 3000);
    }
  }

  async #onMessages({ messages, type }) {
    if (type !== 'notify') return; // نتجاهل مزامنة السجل القديم

    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid || !isJidGroup(jid)) continue;
      if (config.groupJids.length && !config.groupJids.includes(jid)) continue;

      const body = extractText(msg.message);
      if (!body) continue;

      const ctx = contextOf(msg.message);
      const mentioned = ctx?.mentionedJid ?? [];
      const selfNum = this.selfJid?.split('@')[0];
      const isMention =
        !!selfNum && mentioned.some((j) => j.split('@')[0] === selfNum);

      const quoted = ctx?.quotedMessage ? extractText(ctx.quotedMessage) : null;
      const quotedFromMe =
        !!ctx?.participant &&
        !!selfNum &&
        ctx.participant.split('@')[0] === selfNum;

      this.emit('message', {
        id: msg.key.id,
        chatJid: jid,
        chatName: await this.groupName(jid),
        senderJid: msg.key.participantAlt || msg.key.participant || jid,
        senderName: msg.pushName || msg.key.participant?.split('@')[0] || 'مجهول',
        body,
        quoted,
        quotedFromMe,
        isMention,
        fromMe: !!msg.key.fromMe,
        ts: Number(msg.messageTimestamp) * 1000 || Date.now(),
      });
    }
  }

  async groupName(jid) {
    if (this.groupNames.has(jid)) return this.groupNames.get(jid);
    try {
      const meta = await this.sock.groupMetadata(jid);
      this.groupNames.set(jid, meta.subject);
      return meta.subject;
    } catch {
      return jid;
    }
  }

  async listGroups() {
    const all = await this.sock.groupFetchAllParticipating();
    return Object.values(all).map((g) => ({
      jid: g.id,
      name: g.subject,
      participants: g.participants?.length ?? 0,
    }));
  }

  /** يرسل الملخص إلى القروب المصرّح به، أو لمحادثتك مع نفسك إن لم يُحدَّد. */
  async sendDigest(text) {
    const target = config.digestGroupJid || this.selfJid;
    if (!target) throw new Error('غير متصل بواتساب بعد');
    await this.sock.sendMessage(target, { text });
  }

  /** يرسل رسالة إلى محادثة "رسالة لنفسي". */
  async sendToSelf(text) {
    if (!this.selfJid) throw new Error('غير متصل بواتساب بعد');
    await this.sock.sendMessage(this.selfJid, { text });
  }
}
