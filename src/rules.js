import { config, today } from './config.js';
import { normalize } from './db.js';

/**
 * استخراج المهام بالقواعد — بدون Claude وبدون أي تكلفة.
 *
 * الفرق الجوهري عن التصنيف الذكي: هذا الوضع لا يفهم السياق، فهو لا يقرأ
 * كل رسائل القروب بحثًا عن مهام ضمنية. يشتغل على مبدأ ضيق ومتعمّد:
 * الرسالة لازم تكون **موجّهة لك** (منشن، أو رد على رسالتك، أو نداء باسمك)
 * **و** فيها **إشارة طلب** واضحة. بغير هذين الشرطين معًا يتحوّل لمولّد ضجيج.
 */

/** أفعال وصيغ الطلب الشائعة في قروبات العمل بالعامية والفصحى. */
const REQUEST_SIGNALS = [
  // صيغ الطلب المباشرة
  'مطلوب', 'الرجاء', 'رجاء', 'ارجو', 'تكفي', 'لو سمحت', 'ممكن', 'بليز',
  'محتاج', 'نحتاج', 'لازم', 'ضروري', 'يلزم', 'عليك', 'عليكم', 'مهمتك',
  // أفعال أمر متكررة
  'جهز', 'حضر', 'ارفع', 'ارسل', 'راجع', 'اعتمد', 'احجز', 'اكتب', 'وقع',
  'سلم', 'اكمل', 'تاكد', 'تابع', 'رد', 'جاوب', 'شارك', 'عدل', 'صحح',
  'انهي', 'ابدا', 'نسق', 'حدد', 'اضف', 'احذف', 'ارفق', 'نزل', 'حمل',
  // مواعيد والتزامات
  'موعد', 'تسليم', 'ديدلاين', 'اخر موعد', 'قبل', 'تذكير', 'تنبيه',
  'باقي', 'متبقي', 'ما تنسى', 'لا تنسى', 'تذكر',
];

/** إشارات استعجال ترفع الأولوية إلى urgent. */
const URGENT_SIGNALS = [
  'عاجل', 'ضروري', 'مستعجل', 'بسرعه', 'بسرعة', 'اليوم', 'الحين', 'حالا',
  'فورا', 'الان', 'قبل نهايه اليوم', 'مهم جدا',
];

/** إشارات تُعلي الأولوية إلى high دون أن تجعلها عاجلة. */
const HIGH_SIGNALS = ['مهم', 'موعد', 'تسليم', 'ديدلاين', 'اخر موعد', 'العماده', 'الرئيس', 'المدير'];

/** عبارات تنفي أن تكون الرسالة طلبًا — شكر ومجاملات وردود قصيرة. */
const NOISE_SIGNALS = [
  'شكرا', 'مشكور', 'يعطيك العافيه', 'تسلم', 'الله يعافيك', 'ابشر',
  'تم بالفعل', 'خلاص تم', 'وصل', 'مبروك', 'حياك', 'اهلا', 'مرحبا',
  'صباح الخير', 'مساء الخير', 'جزاك الله',
];

const AR_WEEKDAYS = {
  الاحد: 0, الاثنين: 1, الثلاثاء: 2, الاربعاء: 3, الخميس: 4, الجمعه: 5, السبت: 6,
};

const has = (haystack, needles) => needles.some((n) => haystack.includes(normalize(n)));

/** يضيف أيامًا إلى تاريخ YYYY-MM-DD دون التأثر بالمناطق الزمنية. */
function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * يستخرج موعدًا من النص. يرجّع { date, text } أو null.
 * يغطي: اليوم/بكرة/بعد بكرة، أسماء الأيام، والتواريخ الصريحة.
 */
function extractDue(normalized, raw) {
  const base = today();

  // \b في جافاسكربت يعتمد على [A-Za-z0-9_] فلا يطابق حرفًا عربيًا إطلاقًا.
  // نطابق ككلمة كاملة عبر تبطين النص بمسافات — normalize يوحّد المسافات أصلًا.
  const padded = ` ${normalized} `;
  const word = (w) => padded.includes(` ${w} `);

  if (word('بعد بكره') || word('بعد غد')) {
    return { date: addDays(base, 2), text: 'بعد بكرة' };
  }
  if (word('بكره') || word('غدا') || word('غد')) {
    return { date: addDays(base, 1), text: 'بكرة' };
  }
  if (word('اليوم') || word('الحين')) {
    return { date: base, text: 'اليوم' };
  }

  // أسماء الأيام: أقرب يوم قادم يحمل هذا الاسم
  for (const [name, target] of Object.entries(AR_WEEKDAYS)) {
    if (!word(name) && !word(`يوم ${name}`)) continue;
    const current = new Date(`${base}T12:00:00Z`).getUTCDay();
    let diff = (target - current + 7) % 7;
    if (diff === 0) diff = 7; // "الأحد" يوم الأحد تعني الأسبوع القادم
    return { date: addDays(base, diff), text: name };
  }

  // تواريخ صريحة: 2026-09-24 أو 24/9 أو 24-9-2026
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { date: iso[0], text: iso[0] };

  const dmy = raw.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{4}))?\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y || base.slice(0, 4);
    const date = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(date))) return { date, text: dmy[0] };
  }

  if (word('نهايه الاسبوع') || word('نهايه هذا الاسبوع')) {
    const current = new Date(`${base}T12:00:00Z`).getUTCDay();
    return { date: addDays(base, (4 - current + 7) % 7 || 7), text: 'نهاية الأسبوع' };
  }

  return null;
}

/** مجاملات تتصدّر الطلب ولا تضيف معنى للعنوان. */
const TITLE_PREFIXES = [
  'تكفى', 'تكفي', 'لو سمحت', 'لو تكرمت', 'من فضلك', 'الرجاء', 'رجاء',
  'ارجو', 'أرجو', 'ممكن', 'بليز', 'اذا ممكن', 'إذا ممكن', 'عفوا', 'عفوًا',
];

/**
 * عنوان مختصر من نص الرسالة. القواعد ما تقدر تعيد الصياغة مثل النموذج،
 * لكنها تقدر تشيل النداء والمجاملة من البداية فيبان الطلب نفسه أولًا.
 */
function toTitle(raw, myNames) {
  let cleaned = raw
    .replace(/@\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // نقشّر النداء والمجاملات المتصدّرة، بالتكرار لأنها تتراكم: "يا دكتور أحد تكفى ..."
  for (let i = 0; i < 4; i++) {
    const before = cleaned;

    cleaned = cleaned.replace(/^(?:يا|ياا)\s+/u, '');

    for (const name of myNames) {
      const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[،,:]?\\s*`, 'u');
      cleaned = cleaned.replace(re, '');
    }
    for (const p of TITLE_PREFIXES) {
      const re = new RegExp(`^${p}\\s*[،,:]?\\s*`, 'u');
      cleaned = cleaned.replace(re, '');
    }

    if (cleaned === before) break;
  }

  cleaned = cleaned.replace(/^[،,:\s-]+/, '').trim();
  // لو القشر أكل الجملة كلها، نرجع للنص الأصلي
  if (cleaned.length < 8) cleaned = raw.replace(/@\d+/g, '').replace(/\s+/g, ' ').trim();

  if (cleaned.length <= 70) return cleaned;

  // نقصّ عند أقرب فاصل جملة بدل بتر الكلمة
  const cut = cleaned.slice(0, 70);
  const lastBreak = Math.max(cut.lastIndexOf('،'), cut.lastIndexOf('.'), cut.lastIndexOf(' '));
  return `${cut.slice(0, lastBreak > 30 ? lastBreak : 70).trim()}…`;
}

/** الكلمات الإضافية التي يضيفها المستخدم في RULE_KEYWORDS. */
const extraSignals = config.ruleKeywords;

/**
 * يصنّف دفعة رسائل بالقواعد. نفس شكل مخرجات classifyBatch تمامًا،
 * حتى يقدر الـ pipeline يبدّل بين الوضعين بدون أي فرق في التعامل.
 */
export function extractByRules({ messages }) {
  const myNames = config.myNames.map(normalize).filter((n) => n.length >= 2);
  // للعناوين نحتاج الأسماء كما كتبها المستخدم لا مطبّعة، والأطول أولًا حتى
  // يُقشَّر "دكتور أحد" كاملًا بدل أن يلتقط "أحد" وحده ويترك "دكتور".
  const titleNames = [...config.myNames].sort((a, b) => b.length - a.length);
  const tasks = [];

  messages.forEach((msg, index) => {
    if (msg.fromMe) return; // رسائلك أنت ليست طلبات عليك

    const raw = msg.body;
    const text = normalize(raw);

    if (has(text, NOISE_SIGNALS) && text.length < 60) return;

    // الشرط الأول: هل الرسالة موجّهة لك؟
    const byName = myNames.some((n) => text.includes(n));
    const addressed = msg.isMention || msg.quotedFromMe || byName;
    if (!addressed) return;

    // الشرط الثاني: هل فيها إشارة طلب؟
    const requested = has(text, REQUEST_SIGNALS) || has(text, extraSignals);
    if (!requested) return;

    const due = extractDue(text, raw);

    let priority = 'normal';
    if (has(text, URGENT_SIGNALS)) priority = 'urgent';
    else if (due && (due.date === today() || due.date === addDays(today(), 1))) priority = 'urgent';
    else if (has(text, HIGH_SIGNALS) || due) priority = 'high';

    // الثقة تعكس قوة الإشارة: المنشن الصريح أقوى من ورود الاسم في النص
    let confidence = 0.6;
    if (msg.isMention) confidence = 0.8;
    else if (msg.quotedFromMe) confidence = 0.7;
    if (due) confidence += 0.05;
    confidence = Math.min(confidence, 0.85); // القواعد لا تبلغ يقين التصنيف الذكي

    tasks.push({
      message_index: index,
      title: toTitle(raw, titleNames),
      details: '',
      requester: msg.sender_name,
      due_date: due?.date ?? '',
      due_text: due?.text ?? '',
      priority,
      confidence,
    });
  });

  return {
    tasks: tasks.filter((t) => t.confidence >= config.minConfidence),
    usage: null,
    mode: 'rules',
  };
}
