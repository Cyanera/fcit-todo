import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, fallback) =>
  v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);

const list = (v) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  root,
  dataDir: path.join(root, 'data'),
  authDir: path.join(root, 'data', 'wa-auth'),
  dbPath: path.join(root, 'data', 'tasks.db'),

  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || 'claude-opus-5',
  effort: process.env.CLAUDE_EFFORT || 'low',

  // auto = ذكي إذا وُجد مفتاح، وإلا قواعد. أو افرض: claude | rules
  mode: (process.env.MODE || 'auto').toLowerCase(),
  ruleKeywords: list(process.env.RULE_KEYWORDS),

  myNames: list(process.env.MY_NAMES),
  myNumber: (process.env.MY_NUMBER || '').replace(/\D/g, ''),

  groupJids: list(process.env.GROUP_JIDS),

  flushIntervalMs: Number(process.env.FLUSH_INTERVAL_SECONDS || 60) * 1000,
  flushMaxMessages: Number(process.env.FLUSH_MAX_MESSAGES || 25),
  minConfidence: Number(process.env.MIN_CONFIDENCE || 0.6),

  notifyUrgent: bool(process.env.NOTIFY_URGENT, true),
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
