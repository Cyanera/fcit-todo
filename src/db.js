import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  chat_jid    TEXT NOT NULL,
  chat_name   TEXT,
  sender_jid  TEXT,
  sender_name TEXT,
  body        TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT,
  chat_jid    TEXT,
  chat_name   TEXT,
  title       TEXT NOT NULL,
  norm_title  TEXT NOT NULL,
  details     TEXT,
  requester   TEXT,
  due_date    TEXT,
  due_text    TEXT,
  priority    TEXT NOT NULL DEFAULT 'normal',
  confidence  REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open',
  source_text TEXT,
  source_ts   INTEGER,
  created_at  INTEGER NOT NULL,
  done_at     INTEGER,
  notified    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_norm ON tasks(norm_title);

-- شاهد على مهمة حُذفت: يمنع عودتها عند إعادة المعالجة.
-- نحفظ العنوان المطبّع فقط لا نص الرسالة.
CREATE TABLE IF NOT EXISTS dismissed (
  norm_title TEXT NOT NULL,
  chat_jid   TEXT,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (norm_title, chat_jid)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

/**
 * تطبيع النص العربي للمقارنة: يشيل التشكيل والتطويل، ويوحّد الألف/الياء/التاء
 * المربوطة، عشان "تجهيز الاختبار" و"تجهيز الإختبار" ما ينحسبون مهمتين.
 */
export function normalize(text) {
  return (text || '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ترحيل: عمود يميّز المهام المضافة يدويًا عن المستخرجة من القروب.
const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
if (!taskColumns.includes('source')) {
  db.exec(`ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'whatsapp'`);
}

const stmts = {
  insertMessage: db.prepare(`
    INSERT OR IGNORE INTO messages (id, chat_jid, chat_name, sender_jid, sender_name, body, ts)
    VALUES (@id, @chat_jid, @chat_name, @sender_jid, @sender_name, @body, @ts)`),
  markProcessed: db.prepare(`UPDATE messages SET processed = 1 WHERE id = ?`),
  recentContext: db.prepare(`
    SELECT sender_name, body, ts FROM messages
    WHERE chat_jid = ? AND processed = 1
    ORDER BY ts DESC LIMIT ?`),
  insertTask: db.prepare(`
    INSERT INTO tasks (message_id, chat_jid, chat_name, title, norm_title, details, requester,
                       due_date, due_text, priority, confidence, source_text, source_ts,
                       created_at, source)
    VALUES (@message_id, @chat_jid, @chat_name, @title, @norm_title, @details, @requester,
            @due_date, @due_text, @priority, @confidence, @source_text, @source_ts,
            @created_at, @source)`),
  // أي حالة لا المفتوحة وحدها: المهمة المنجزة يجب ألا تعود مفتوحة
  findDuplicate: db.prepare(`
    SELECT id FROM tasks
    WHERE norm_title = ? AND created_at > ?
    LIMIT 1`),
  findDismissed: db.prepare(`
    SELECT 1 FROM dismissed WHERE norm_title = ? AND deleted_at > ? LIMIT 1`),
  dismiss: db.prepare(`
    INSERT INTO dismissed (norm_title, chat_jid, deleted_at) VALUES (?, ?, ?)
    ON CONFLICT(norm_title, chat_jid) DO UPDATE SET deleted_at = excluded.deleted_at`),
  getTaskRow: db.prepare(`SELECT norm_title, chat_jid FROM tasks WHERE id = ?`),
  // المهمة الدورية تتكرر بنفس العنوان أسبوعيًا، فالتاريخ جزء من هويتها
  findRecurring: db.prepare(`
    SELECT 1 FROM tasks
    WHERE norm_title = ? AND due_date = ? AND source = 'recurring' LIMIT 1`),
  listTasks: db.prepare(`
    SELECT * FROM tasks
    WHERE (@status = 'all' OR status = @status)
    ORDER BY
      CASE status WHEN 'open' THEN 0 ELSE 1 END,
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
      due_date ASC,
      source_ts DESC`),
  setStatus: db.prepare(`UPDATE tasks SET status = ?, done_at = ? WHERE id = ?`),
  deleteTask: db.prepare(`DELETE FROM tasks WHERE id = ?`),
  updateTask: db.prepare(`
    UPDATE tasks SET title = @title, details = @details, due_date = @due_date,
                     priority = @priority WHERE id = @id`),
  unnotifiedUrgent: db.prepare(`
    SELECT * FROM tasks WHERE status = 'open' AND notified = 0 AND priority IN ('urgent','high')`),
  markNotified: db.prepare(`UPDATE tasks SET notified = 1 WHERE id = ?`),
  // المهام الدورية مستثناة: جدول ثابت تعرفه المستخدمة سلفًا، وإدراجه
  // كل صباح يُغرق الملخص بما لا جديد فيه
  openTasksForDigest: db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'open' AND source != 'recurring'
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
             CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC`),
  counts: db.prepare(`
    SELECT
      SUM(status = 'open')  AS open,
      SUM(status = 'done')  AS done,
      SUM(status = 'open' AND priority = 'urgent') AS urgent
    FROM tasks`),
  unprocessed: db.prepare(`
    SELECT * FROM messages
    WHERE processed = 0 AND ts > ?
    ORDER BY ts ASC`),
  latestTaskInChat: db.prepare(`
    SELECT id, details, source_ts FROM tasks
    WHERE chat_jid = ? AND status = 'open'
    ORDER BY source_ts DESC LIMIT 1`),
  appendDetails: db.prepare(`UPDATE tasks SET details = ? WHERE id = ?`),

  getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
  setMeta: db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
                       ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
};

export const store = {
  saveMessage: (m) => stmts.insertMessage.run(m),
  markProcessed: (id) => stmts.markProcessed.run(id),

  recentContext(chatJid, limit = 12) {
    return stmts.recentContext.all(chatJid, limit).reverse();
  },

  /**
   * يرجّع id المهمة الجديدة، أو null لو كانت مكررة.
   * فحص التكرار يخص المهام المستخرجة تلقائيًا — الإضافة اليدوية تتخطاه
   * لأن المستخدم يعرف ما يضيف.
   */
  addTask(task, { skipDedup = false } = {}) {
    const norm = normalize(task.title);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (!skipDedup) {
      if (stmts.findDuplicate.get(norm, weekAgo)) return null;
      // حذفتِها عمدًا — لا تعود عند إعادة المعالجة
      if (stmts.findDismissed.get(norm, weekAgo)) return null;
    }
    const info = stmts.insertTask.run({
      message_id: null,
      chat_jid: null,
      chat_name: null,
      details: null,
      requester: null,
      due_date: null,
      due_text: null,
      priority: 'normal',
      confidence: 1,
      source_text: null,
      source_ts: Date.now(),
      source: 'whatsapp',
      ...task,
      norm_title: norm,
      created_at: Date.now(),
    });
    return info.lastInsertRowid;
  },

  hasRecurring: (normTitle, dueDate) => !!stmts.findRecurring.get(normTitle, dueDate),

  listTasks: (status = 'open') => stmts.listTasks.all({ status }),
  setStatus: (id, status) =>
    stmts.setStatus.run(status, status === 'done' ? Date.now() : null, id),
  /**
   * يحذف المهمة نهائيًا من الجدول، ويترك شاهدًا بعنوانها المطبّع حتى لا
   * تعود عند إعادة المعالجة — فالرسالة الأصلية تبقى محفوظة.
   */
  deleteTask(id) {
    const row = stmts.getTaskRow.get(id);
    if (row) stmts.dismiss.run(row.norm_title, row.chat_jid ?? '', Date.now());
    return stmts.deleteTask.run(id);
  },
  updateTask: (t) => stmts.updateTask.run(t),
  unnotifiedUrgent: () => stmts.unnotifiedUrgent.all(),
  markNotified: (id) => stmts.markNotified.run(id),
  openTasksForDigest: () => stmts.openTasksForDigest.all(),
  counts: () => stmts.counts.get(),
  /**
   * يُلحق روابط بآخر مهمة في القروب إن كانت قريبة زمنيًا.
   * المحتوى المحوّل يصل على رسالتين — النص ثم الرابط — وقد تفصلهما حدود
   * الدفعة، فنصل الرابط بسابقته بدل أن نصنع منه مهمة بلا معنى.
   * يرجّع id المهمة، أو null إذا لم توجد سابقة قريبة.
   */
  /**
   * رسائل حُفظت ولم تُعالَج — يحدث إذا توقف البوت بين الحفظ والمعالجة.
   * نحدّها بمدة حتى لا نستأنف سجلًا قديمًا عند أول تشغيل بعد انقطاع طويل.
   */
  unprocessedMessages: (withinMs = 24 * 60 * 60 * 1000) =>
    stmts.unprocessed.all(Date.now() - withinMs),

  attachLinks(chatJid, links, withinMs = 15 * 60 * 1000) {
    if (!links.length) return null;
    const latest = stmts.latestTaskInChat.get(chatJid);
    if (!latest || Date.now() - latest.source_ts > withinMs) return null;

    const existing = (latest.details || '').split('\n').filter(Boolean);
    const merged = [...new Set([...existing, ...links])].join('\n');
    if (merged !== (latest.details || '')) stmts.appendDetails.run(merged, latest.id);
    return latest.id;
  },

  getMeta: (k) => stmts.getMeta.get(k)?.value ?? null,
  setMeta: (k, v) => stmts.setMeta.run(k, String(v)),
};
