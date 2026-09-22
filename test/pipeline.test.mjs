import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// قاعدة مؤقتة: لا نلمس قاعدة النسخة العاملة
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')), 'test.db');
process.env.DB_PATH = tmpDb;
process.env.MY_NAMES = 'عهد';
process.env.MODE = 'rules';
process.env.INBOX_MODE = 'false'; // لا نرث إعداد .env الحقيقي
process.env.NOTIFY_URGENT = 'false';

const { Pipeline } = await import('../src/pipeline.js');
const { store } = await import('../src/db.js');

const msg = (jid, name, body, i) => ({
  id: `m${i}`, chatJid: jid, chatName: name,
  senderJid: 's@s.net', senderName: 'زميلة', body,
  quoted: null, quotedFromMe: false, isMention: false, fromMe: false,
  ts: Date.now() + i,
});

test('يفصل الدفعة حسب القروب فتُنسب كل مهمة لقروبها', async () => {
  // الرسائل تتداخل زمنيًا بين القروبات، فالدفعة الواحدة تخلطها.
  // قبل الإصلاح كانت كل المهام تُنسب لقروب أول رسالة في الدفعة.
  const pipeline = new Pipeline({ status: 'connected', sendToSelf: async () => {} });

  const messages = [
    ['A@g.us', 'قسم تقنية المعلومات', 'لازم نرفع الدرجات قبل الخميس'],
    ['B@g.us', 'لجنة الجودة', 'مطلوب تعبئة نموذج التقييم'],
    ['A@g.us', 'قسم تقنية المعلومات', 'صباح الخير'],
    ['C@g.us', 'الإرشاد الأكاديمي', 'ضروري ترسلون قوائم الطلاب اليوم'],
  ];
  messages.forEach(([jid, name, body], i) => pipeline.add(msg(jid, name, body, i)));

  await pipeline.flush();

  const tasks = store.listTasks('open');
  assert.equal(tasks.length, 3, 'ثلاث مهام من ثلاثة قروبات');

  const byGroup = Object.fromEntries(tasks.map((t) => [t.chat_name, t.title]));
  assert.ok(byGroup['قسم تقنية المعلومات']?.includes('الدرجات'));
  assert.ok(byGroup['لجنة الجودة']?.includes('نموذج التقييم'));
  assert.ok(byGroup['الإرشاد الأكاديمي']?.includes('قوائم الطلاب'));

  // ولا مهمة بلا قروب أو بقروب خاطئ
  for (const t of tasks) assert.ok(t.chat_jid, `مهمة بلا قروب: ${t.title}`);
});

test('المهمة المحذوفة لا تعود عند إعادة المعالجة', () => {
  const id = store.addTask({
    chat_jid: 'Z@g.us', chat_name: 'قروب', title: 'ارفع التقرير الشهري',
    source_text: 'ارفع التقرير الشهري', source_ts: Date.now(),
  }, { skipDedup: true });

  store.deleteTask(id);
  assert.equal(store.listTasks('all').filter((t) => t.id === id).length, 0, 'حُذفت فعلًا');

  // نفس العنوان مرة أخرى — كما يفعل reprocess
  const again = store.addTask({
    chat_jid: 'Z@g.us', chat_name: 'قروب', title: 'ارفع التقرير الشهري',
    source_text: 'ارفع التقرير الشهري', source_ts: Date.now(),
  });
  assert.equal(again, null, 'الشاهد يمنع عودتها');
});

test('المهمة المنجزة لا تعود مفتوحة عند إعادة المعالجة', () => {
  const id = store.addTask({
    chat_jid: 'Y@g.us', chat_name: 'قروب', title: 'سلّم خطة المقرر',
    source_text: 'سلّم خطة المقرر', source_ts: Date.now(),
  }, { skipDedup: true });

  store.setStatus(id, 'done');
  const again = store.addTask({
    chat_jid: 'Y@g.us', chat_name: 'قروب', title: 'سلّم خطة المقرر',
    source_text: 'سلّم خطة المقرر', source_ts: Date.now(),
  });
  assert.equal(again, null, 'منع التكرار يشمل المنجزة');
});
