import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, fallback) =>
  v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);

/**
 * يفصل قائمة مكتوبة يدويًا في .env.
 * يقبل الفاصلة العربية «،» والإنجليزية «,» والفاصلة المنقوطة «؛» و«;»،
 * لأن من يكتب أسماء عربية سيستخدم لوحة مفاتيح عربية بطبيعة الحال.
 */
const list = (v) =>
  (v ?? '')
    .split(/[,،;؛]/)
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  root,
  // DATA_DIR يسمح بعزل الحالة عن النسخة العاملة — للاختبار خاصةً
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  authDir: path.join(process.env.DATA_DIR || path.join(root, 'data'), 'wa-auth'),
  // DB_PATH يسمح بتشغيل نسخة على قاعدة منفصلة — للاختبار دون المساس
  // بقاعدة النسخة العاملة، فحذف ملفها تحت رجل عملية شغّالة يفقد كتاباتها.
  dbPath:
    process.env.DB_PATH ||
    path.join(process.env.DATA_DIR || path.join(root, 'data'), 'tasks.db'),

  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || 'claude-opus-5',
  effort: process.env.CLAUDE_EFFORT || 'low',

  // auto = ذكي إذا وُجد مفتاح، وإلا قواعد. أو افرض: claude | rules
  mode: (process.env.MODE || 'auto').toLowerCase(),
  ruleKeywords: list(process.env.RULE_KEYWORDS),

  // رسائلك أنت ليست طلبات عليك عادةً، لكن تفعيلها مفيد للتجربة وحدك
  // في قروب اختبار، أو لمن يكتب مهامه بنفسه في القروب.
  includeOwnMessages: bool(process.env.INCLUDE_OWN_MESSAGES, false),

  /**
   * وضع صندوق الوارد: القروب المراقَب ليس قروب عمل بل صندوق تحوّل إليه
   * الرسائل يدويًا. كل رسالة تصل = مهمة بحكم وصولها، فلا حاجة لتخمين
   * «هل هذا طلب؟». العمل كله يصير استخلاصًا: ما المطلوب، وما روابطه،
   * وما موعده. يتضمن رسائلك أنت لأن التحويل يأتي منك.
   */
  inboxMode: bool(process.env.INBOX_MODE, false),

  myNames: list(process.env.MY_NAMES),
  otherNames: list(process.env.OTHER_NAMES),
  myNumber: (process.env.MY_NUMBER || '').replace(/\D/g, ''),

  groupJids: list(process.env.GROUP_JIDS),

  flushIntervalMs: Number(process.env.FLUSH_INTERVAL_SECONDS || 60) * 1000,
  flushMaxMessages: Number(process.env.FLUSH_MAX_MESSAGES || 25),
  minConfidence: Number(process.env.MIN_CONFIDENCE || 0.6),

  notifyUrgent: bool(process.env.NOTIFY_URGENT, true),

  /**
   * القروب الوحيد المصرّح للبوت بالإرسال إليه — للملخص اليومي.
   * اتركه فاضيًا فيبقى المنع تامًّا ويصل الملخص لـ«رسالة لنفسي».
   * يجب أن يُكتب صراحةً: لا يُستنتج من GROUP_JIDS حتى لا يتسرّب
   * الإرسال إلى قروب عمل بمجرد إضافته للمراقبة.
   */
  digestGroupJid: (process.env.DIGEST_GROUP_JID || '').trim(),
  dailyDigestAt: (process.env.DAILY_DIGEST_AT || '').trim(),

  tz: process.env.TZ || 'Asia/Riyadh',
  port: Number(process.env.PORT || 3777),
};

/**
 * القالب في .env.example يحمل `sk-ant-...` كمثال. لو تُرك كما هو فهو ليس
 * مفتاحًا — نعتبره غائبًا حتى لا يحاول البوت الاتصال ويفشل عند كل دفعة.
 */
export function hasRealKey() {
  const k = config.anthropicKey;
  return !!k && k.startsWith('sk-ant-') && k.length > 25 && !k.includes('...');
}

/** الوضع الفعلي بعد حسم `auto`: 'claude' أو 'rules'. */
export function activeMode() {
  if (config.mode === 'rules') return 'rules';
  if (config.mode === 'claude') return 'claude';
  return hasRealKey() ? 'claude' : 'rules';
}

/** التاريخ الحالي بصيغة YYYY-MM-DD في المنطقة الزمنية المضبوطة. */
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** اسم اليوم بالعربي — يساعد Claude يفهم "الأحد الجاي". */
export function todayName() {
  return new Intl.DateTimeFormat('ar', {
    timeZone: config.tz,
    weekday: 'long',
  }).format(new Date());
}

export function localTimeHHMM() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}
