import fs from 'node:fs';
import path from 'node:path';
import { config, today } from './config.js';
import { store, normalize } from './db.js';

/**
 * المهام الدورية — تحضير المواد حسب جدول أسبوعي ثابت.
 *
 * تُنشأ المهمة قبل يوم المحاضرة بيوم (leadDays)، وموعدها يوم المحاضرة نفسه.
 * فمحاضرة الأحد تظهر مهمتها يوم السبت بموعد الأحد.
 *
 * لا تمر على منع التكرار العام: المادة الواحدة تتكرر ثلاث مرات في الأسبوع
 * بنفس العنوان، والمنع العام (أسبوع واحد بنفس العنوان) كان سيحجب الثانية
 * والثالثة. نمنع التكرار هنا بالعنوان **والتاريخ** معًا.
 */

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const configPath = () => path.join(config.root, 'recurring.json');

/** يقرأ الجدول، أو يرجّع null إن لم يُضبط. */
export function loadSchedule() {
  const file = configPath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed.tasks)) throw new Error('الحقل tasks ناقص أو ليس قائمة');
    return {
      leadDays: Number.isInteger(parsed.leadDays) ? parsed.leadDays : 1,
      priority: ['urgent', 'high', 'normal'].includes(parsed.priority) ? parsed.priority : 'high',
      tasks: parsed.tasks.filter((t) => t.title && Array.isArray(t.days)),
    };
  } catch (err) {
    console.error(`⚠️  تعذّرت قراءة recurring.json: ${err.message}`);
    return null;
  }
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayOf = (isoDate) => new Date(`${isoDate}T12:00:00Z`).getUTCDay();

/**
 * ينشئ مهام الأيام القادمة ضمن مدى الإشعار.
 * آمن للتكرار: يُستدعى عند كل إقلاع وكل ساعة دون أن يُضاعف شيئًا.
 * يرجّع عدد ما أُنشئ.
 */
export function syncRecurring(schedule = loadSchedule(), from = today()) {
  if (!schedule?.tasks.length) return 0;

  let created = 0;
  // نغطي من اليوم حتى مدى الإشعار، فلا تفوت مهمة لو تعطّل البوت يومًا
  for (let offset = 0; offset <= schedule.leadDays; offset++) {
    const dueDate = addDays(from, offset);
    const weekday = weekdayOf(dueDate);

    for (const item of schedule.tasks) {
      if (!item.days.includes(weekday)) continue;
      if (store.hasRecurring(normalize(item.title), dueDate)) continue;

      store.addTask(
        {
          title: item.title,
          details: item.details || null,
          requester: 'جدول أسبوعي',
          due_date: dueDate,
          due_text: AR_DAYS[weekday],
          priority: item.priority || schedule.priority,
          confidence: 1,
          source: 'recurring',
          source_ts: Date.now(),
        },
        { skipDedup: true }, // المنع هنا بالعنوان والتاريخ لا بالعنوان وحده
      );
      created++;
    }
  }
  return created;
}

/** يبدأ المزامنة الدورية. الفحص كل ساعة يكفي لجدول يومي. */
export function startRecurring(intervalMs = 60 * 60 * 1000) {
  const schedule = loadSchedule();
  if (!schedule) return null;

  const run = () => {
    const n = syncRecurring(schedule);
    if (n) console.log(`🔁 أُضيفت ${n} مهمة دورية.`);
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
