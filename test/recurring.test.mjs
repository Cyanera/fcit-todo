import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')), 'test.db');
process.env.MODE = 'rules';
process.env.INBOX_MODE = 'false';

const { syncRecurring } = await import('../src/recurring.js');
const { store } = await import('../src/db.js');

const schedule = {
  leadDays: 1,
  priority: 'high',
  tasks: [
    { title: 'تحضير ذكاء اصطناعي', days: [0, 2, 4] },   // أحد وثلاثاء وخميس
    { title: 'تحضير معمل برمجة شيئية', days: [0] },      // أحد فقط
    { title: 'تحضير معمل ذكاء اصطناعي', days: [3] },     // أربعاء
  ],
};

const titlesDue = (date) =>
  store.listTasks('all').filter((t) => t.due_date === date).map((t) => t.title).sort();

test('تُنشأ المهمة قبل يوم المحاضرة بيوم', () => {
  // 2026-09-26 سبت → محاضرات الأحد 2026-09-27
  syncRecurring(schedule, '2026-09-26');
  assert.deepEqual(titlesDue('2026-09-27'), ['تحضير ذكاء اصطناعي', 'تحضير معمل برمجة شيئية'].sort());
});

test('لا تُنشأ مهام ليوم لا محاضرة فيه', () => {
  // 2026-09-27 أحد → الاثنين 2026-09-28 بلا محاضرات في هذا الجدول
  syncRecurring(schedule, '2026-09-27');
  assert.deepEqual(titlesDue('2026-09-28'), []);
});

test('المادة نفسها تتكرر في الأسبوع بتواريخ مختلفة', () => {
  syncRecurring(schedule, '2026-09-28'); // اثنين → ثلاثاء
  syncRecurring(schedule, '2026-09-30'); // أربعاء → خميس

  const ai = store.listTasks('all')
    .filter((t) => t.title === 'تحضير ذكاء اصطناعي')
    .map((t) => t.due_date)
    .sort();

  // الأحد والثلاثاء والخميس — منع التكرار العام كان سيحجب الثاني والثالث
  assert.deepEqual(ai, ['2026-09-27', '2026-09-29', '2026-10-01']);
});

test('تكرار الاستدعاء لا يضاعف المهام', () => {
  const before = store.listTasks('all').length;
  syncRecurring(schedule, '2026-09-26');
  syncRecurring(schedule, '2026-09-26');
  assert.equal(store.listTasks('all').length, before);
});

test('المهام الدورية موسومة بمصدرها ومنفصلة عن الواردة', () => {
  const recurring = store.listTasks('all').filter((t) => t.source === 'recurring');
  assert.ok(recurring.length > 0);
  for (const t of recurring) {
    assert.equal(t.requester, 'جدول أسبوعي');
    assert.equal(t.priority, 'high');
    assert.ok(t.due_text, 'اسم اليوم بالعربي');
  }
});

test('جدول فارغ أو غائب لا يُنشئ شيئًا', () => {
  assert.equal(syncRecurring(null, '2026-09-26'), 0);
  assert.equal(syncRecurring({ leadDays: 1, priority: 'high', tasks: [] }, '2026-09-26'), 0);
});
