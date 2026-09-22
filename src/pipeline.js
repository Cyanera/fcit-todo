import { config, localTimeHHMM, today, activeMode } from './config.js';
import { store } from './db.js';
import { classifyBatch } from './classify.js';
import { extractByRules } from './rules.js';

const PRIORITY_LABEL = { urgent: '🔴 عاجل', high: '🟠 مهم', normal: '🔵 عادي' };

/**
 * يجمّع رسائل القروب في دفعات ويمرّرها على Claude، ثم يسجّل المهام
 * ويرسل التنبيهات. التجميع مقصود: يوفّر تكلفة ويعطي النموذج سياقًا أوسع.
 */
export class Pipeline {
  constructor(wa) {
    this.wa = wa;
    this.buffer = [];
    this.timer = null;
    this.busy = false;
    this.stats = { batches: 0, tasks: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  }

  add(message) {
    // نخزّن كل رسالة أولًا — حتى لو فشل التصنيف لاحقًا لا نفقد شيئًا.
    store.saveMessage({
      id: message.id,
      chat_jid: message.chatJid,
      chat_name: message.chatName,
      sender_jid: message.senderJid,
      sender_name: message.senderName,
      body: message.body,
      ts: message.ts,
    });

    this.buffer.push(message);

    if (this.buffer.length >= config.flushMaxMessages) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), config.flushIntervalMs);
    }
  }

  /**
   * يستأنف الرسائل التي حُفظت ولم تُعالَج قبل توقف سابق.
   * الحفظ يسبق المعالجة عمدًا، فلو مات البوت بينهما بقيت الرسالة محفوظة
   * وحدها بلا مهمة. هذه الدالة تسترجعها عند الإقلاع.
   */
  resumePending() {
    const rows = store.unprocessedMessages();
    const wanted = config.groupJids.length
      ? rows.filter((r) => config.groupJids.includes(r.chat_jid))
      : rows;
    if (!wanted.length) return 0;

    console.log(`↻ استئناف ${wanted.length} رسالة حُفظت ولم تُعالَج.`);
    for (const r of wanted) {
      this.buffer.push({
        id: r.id,
        chatJid: r.chat_jid,
        chatName: r.chat_name,
        senderJid: r.sender_jid,
        senderName: r.sender_name,
        body: r.body,
        quoted: null,
        quotedFromMe: false,
        isMention: false,
        fromMe: false,
        ts: r.ts,
      });
    }
    this.flush();
    return wanted.length;
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;

    if (this.busy || !this.buffer.length) return;
    const drained = this.buffer.splice(0, this.buffer.length);
    this.busy = true;

    // نفصل الدفعة حسب القروب: الخلط يُفسد نسبة المهمة لقروبها، ويُفسد
    // السياق الذي يُبنى من رسائل القروب نفسه. يظهر هذا فقط عند مراقبة
    // أكثر من قروب، فالرسائل تتداخل زمنيًا في دفعة واحدة.
    const byChat = new Map();
    for (const m of drained) {
      if (!byChat.has(m.chatJid)) byChat.set(m.chatJid, []);
      byChat.get(m.chatJid).push(m);
    }

    const failed = [];
    try {
      for (const [, batch] of byChat) {
        try {
          await this.#process(batch);
        } catch (err) {
          console.error(`❌ فشل تصنيف دفعة (${batch[0].chatName}):`, err.message);
          failed.push(...batch); // نُعيد قروبًا واحدًا للطابور لا الجميع
        }
      }
    } finally {
      if (failed.length) this.buffer.unshift(...failed);
      this.busy = false;
      if (this.buffer.length) this.timer = setTimeout(() => this.flush(), 5000);
    }
  }

  async #process(batch) {
    const chatJid = batch[0].chatJid;

    const mode = activeMode();
    let result;

    if (mode === 'rules') {
      // وضع القواعد يحتاج الإشارات خامًا (منشن، رد عليك) لا مدموجة في النص
      result = extractByRules({
        messages: batch.map((m) => ({
          sender_name: m.senderName,
          fromMe: m.fromMe,
          isMention: m.isMention,
          quotedFromMe: m.quotedFromMe,
          body: m.body,
        })),
      });
    } else {
      // نضيف علامات تساعد النموذج: منشن صريح، أو رد على رسالة المستخدم.
      const forModel = batch.map((m) => ({
        sender_name: m.senderName,
        fromMe: m.fromMe,
        body: [
          m.isMention ? '(منشن لك) ' : '',
          m.quoted ? `(ردًا على${m.quotedFromMe ? ' رسالتك' : ''}: "${m.quoted.slice(0, 120)}") ` : '',
          m.body,
        ].join(''),
      }));

      const openTasks = store.listTasks('open').slice(0, 40).map((t) => t.title);
      const context = store.recentContext(chatJid, 12).map((m) => ({
        sender_name: m.sender_name,
        body: m.body,
      }));

      result = await classifyBatch({ messages: forModel, context, openTasks });
    }

    for (const m of batch) store.markProcessed(m.id);

    this.stats.batches++;
    if (result.usage) {
      this.stats.inputTokens += result.usage.input_tokens ?? 0;
      this.stats.outputTokens += result.usage.output_tokens ?? 0;
      this.stats.cachedTokens += result.usage.cache_read_input_tokens ?? 0;
    }

    if (result.refused) {
      console.warn(`⚠️  رُفضت دفعة (${result.refused}) — تم تخطيها.`);
      return;
    }

    // روابط يتيمة: سابقتها في دفعة مضت، فنصلها بآخر مهمة في القروب
    if (result.orphanLinks?.length) {
      const attachedTo = store.attachLinks(chatJid, result.orphanLinks);
      if (attachedTo) {
        console.log(`🔗 أُلحق ${result.orphanLinks.length} رابطًا بمهمة سابقة.`);
      } else if (!result.tasks.length) {
        // لا سابقة قريبة — لا نُضيّع الرابط
        store.addTask({
          chat_jid: chatJid,
          chat_name: batch[0].chatName,
          title: 'رابط بلا سياق — راجعيه',
          details: result.orphanLinks.join('\n'),
          source_text: batch.map((m) => m.body).join('\n'),
          source_ts: batch[0].ts,
          confidence: 1,
        }, { skipDedup: true });
        console.log('🔗 رابط بلا سابقة — سُجّل كمهمة للمراجعة.');
      }
    }

    const created = [];
    for (const t of result.tasks) {
      const src = batch[t.message_index];
      const id = store.addTask({
        message_id: src?.id ?? null,
        chat_jid: chatJid,
        chat_name: batch[0].chatName,
        title: t.title.trim(),
        details: t.details?.trim() || null,
        requester: t.requester?.trim() || src?.senderName || null,
        due_date: t.due_date?.trim() || null,
        due_text: t.due_text?.trim() || null,
        priority: t.priority,
        confidence: t.confidence,
        source_text: src?.body ?? null,
        source_ts: src?.ts ?? Date.now(),
      });
      if (id) created.push({ id, ...t });
    }

    this.stats.tasks += created.length;

    if (created.length) {
      console.log(
        `📝 ${batch.length} رسالة ← ${created.length} مهمة جديدة: ` +
          created.map((t) => t.title).join(' | '),
      );
      await this.#notifyUrgent();
    } else {
      console.log(`· ${batch.length} رسالة — لا مهام.`);
    }
  }

  async #notifyUrgent() {
    if (!config.notifyUrgent) return;
    const pending = store.unnotifiedUrgent();
    if (!pending.length) return;

    const lines = pending.map((t) => {
      const due = t.due_date ? ` — ⏳ ${t.due_date}` : t.due_text ? ` — ⏳ ${t.due_text}` : '';
      return `${PRIORITY_LABEL[t.priority]} ${t.title}${due}\n   من: ${t.requester || '—'}`;
    });

    try {
      await this.wa.sendToSelf(
        `⚡ مهام تحتاج انتباهك\n\n${lines.join('\n\n')}\n\nاللوحة: http://localhost:${config.port}`,
      );
      for (const t of pending) store.markNotified(t.id);
    } catch (err) {
      console.error('❌ تعذّر إرسال التنبيه:', err.message);
    }
  }

  /**
   * ملخص الصباح: المهام المفتوحة غير الدورية.
   * الدورية مستثناة لأنها جدول ثابت تعرفه المستخدمة سلفًا، وإدراجه كل
   * صباح يُغرق الملخص بما لا جديد فيه.
   */
  #digestBody() {
    const open = store.openTasksForDigest();
    if (!open.length) return null;

    const now = today();
    const overdue = open.filter((t) => t.due_date && t.due_date < now);
    const dueToday = open.filter((t) => t.due_date === now);
    const rest = open.filter((t) => !overdue.includes(t) && !dueToday.includes(t));

    const line = (t) => {
      const due = t.due_date ? ` — ${t.due_date}` : t.due_text ? ` — ${t.due_text}` : '';
      return `• ${t.title}${due}`;
    };

    const parts = [];
    if (overdue.length) parts.push(`⚠️ متأخرة (${overdue.length})\n${overdue.map(line).join('\n')}`);
    if (dueToday.length) parts.push(`🔴 اليوم (${dueToday.length})\n${dueToday.map(line).join('\n')}`);
    if (rest.length) parts.push(`📋 قادمة (${rest.length})\n${rest.map(line).join('\n')}`);

    return `☀️ مهام غير منجزة — ${now}\n\n${parts.join('\n\n')}\n\nاللوحة: http://localhost:${config.port}`;
  }

  /** ملخص يومي في الوقت المحدد بـ DAILY_DIGEST_AT. */
  startDigestTimer() {
    if (!/^\d{2}:\d{2}$/.test(config.dailyDigestAt)) return;

    setInterval(async () => {
      if (localTimeHHMM() !== config.dailyDigestAt) return;
      if (store.getMeta('last_digest') === today()) return;
      store.setMeta('last_digest', today());

      const body = this.#digestBody();
      if (!body) {
        console.log('📬 لا مهام مفتوحة — لم يُرسل ملخص.');
        return;
      }

      try {
        await this.wa.sendDigest(body);
        console.log(
          `📬 أُرسل ملخص الصباح إلى ${config.digestGroupJid || 'محادثتك مع نفسك'}.`,
        );
      } catch (err) {
        console.error('❌ تعذّر إرسال الملخص:', err.message);
      }
    }, 30_000);
  }
}
