import { config, activeMode } from './config.js';
import { db, store } from './db.js';
import { extractByRules } from './rules.js';
import { classifyBatch } from './classify.js';

/**
 * يعيد استخلاص المهام من رسائل محفوظة سابقًا.
 *
 * الرسائل تُحفظ كلها، لكن الاستخلاص يجري مرة واحدة وتُوسم الرسالة
 * `processed`. فإذا تغيّر الوضع أو تحسّنت القواعد، تبقى الرسائل القديمة
 * على نتيجتها الأولى. هذه الأداة تُعيد عليها الاستخلاص الحالي.
 *
 * لا تتصل بواتساب إطلاقًا — تقرأ من قاعدة البيانات فقط، فيمكن تشغيلها
 * والبوت يعمل. ومنع التكرار في addTask يحمي من ازدواج المهام.
 *
 * الاستخدام:  npm run reprocess [عدد الساعات]   (الافتراضي 48)
 */

const hours = Number(process.argv[2]) || 48;
const since = Date.now() - hours * 60 * 60 * 1000;

const rows = db
  .prepare('SELECT * FROM messages WHERE ts > ? ORDER BY ts ASC')
  .all(since)
  .filter((r) => !config.groupJids.length || config.groupJids.includes(r.chat_jid));

if (!rows.length) {
  console.log(`لا توجد رسائل محفوظة خلال آخر ${hours} ساعة.`);
  process.exit(0);
}

console.log(
  `↻ إعادة استخلاص ${rows.length} رسالة من آخر ${hours} ساعة ` +
    `(الوضع: ${config.inboxMode ? 'صندوق وارد' : activeMode()}).\n`,
);

// نفصل حسب القروب كما يفعل الـ pipeline تمامًا
const byChat = new Map();
for (const r of rows) {
  if (!byChat.has(r.chat_jid)) byChat.set(r.chat_jid, []);
  byChat.get(r.chat_jid).push(r);
}

let created = 0;
let skipped = 0;

for (const [chatJid, batch] of byChat) {
  const messages = batch.map((r) => ({
    sender_name: r.sender_name,
    fromMe: false,
    isMention: false,
    quotedFromMe: false,
    body: r.body,
  }));

  const result =
    activeMode() === 'rules'
      ? extractByRules({ messages })
      : await classifyBatch({ messages, context: [], openTasks: [] });

  if (result.orphanLinks?.length) {
    store.attachLinks(chatJid, result.orphanLinks);
  }

  for (const t of result.tasks) {
    const src = batch[t.message_index];
    const id = store.addTask({
      message_id: src?.id ?? null,
      chat_jid: chatJid,
      chat_name: batch[0].chat_name,
      title: t.title.trim(),
      details: t.details?.trim() || null,
      requester: t.requester?.trim() || src?.sender_name || null,
      due_date: t.due_date?.trim() || null,
      due_text: t.due_text?.trim() || null,
      priority: t.priority,
      confidence: t.confidence,
      source_text: src?.body ?? null,
      source_ts: src?.ts ?? Date.now(),
    });

    if (id) {
      created++;
      const due = t.due_date ? ` ⏳ ${t.due_date}` : '';
      console.log(`  ✓ ${t.title}${due}`);
      if (t.details) console.log(`      ${t.details.split('\n').join('\n      ')}`);
    } else {
      skipped++;
    }
  }
}

console.log(
  `\n✅ ${created} مهمة جديدة` +
    (skipped ? ` · ${skipped} مكررة تُخطّيت` : '') +
    `\n   اللوحة: http://localhost:${config.port}`,
);
process.exit(0);
