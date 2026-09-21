import { config, today } from './config.js';
import { normalize } from './db.js';

/**
 * استخراج المهام بالقواعد — بدون Claude وبدون أي تكلفة.
 *
 * المبدأ: أغلب مهام قروبات العمل تُطلب من الجميع بلا تخصيص («لازم نرفع
 * الدرجات قبل الخميس»)، والمهام المخصصة بالاسم نادرة. لذلك القاعدة هي
 * **الالتقاط الواسع**: أي رسالة فيها إشارة طلب تُعتبر مهمة عليك —
 * إلا إذا كانت موجّهة صراحةً لشخص آخر، فتُستبعد.
 *
 * النداء باسمك لا يُشترط؛ هو فقط يرفع نسبة الثقة.
 */

/**
 * إشارات قوية: صيغ طلب لا تحتمل معنى آخر. وجودها وحده يكفي.
 */
const STRONG_SIGNALS = [
  'مطلوب', 'الرجاء', 'رجاء', 'ارجو', 'تكفي', 'لو سمحت', 'بليز', 'ممكن',
  'محتاج', 'نحتاج', 'لازم', 'ضروري', 'يلزم', 'مهمتك', 'المطلوب منك',
  'موعد', 'تسليم', 'ديدلاين', 'اخر موعد', 'تذكير', 'تنبيه',
  'ما تنسى', 'لا تنسى', 'لا تنسون', 'ما تنسون', 'الحضور', 'الاطلاع',
];

/**
 * أفعال الطلب. تُطابق عند بداية الكلمة، لكن **تُستبعد صيغ الماضي**:
 * «أرسلت التعميم» خبر لا طلب، بينما «أرسل التعميم» طلب. القاعدة لا تفهم
 * الزمن، فنستدل عليه بلاحقات الماضي (ت، تُم، نا، وا).
 */
const VERB_SIGNALS = [
  'جهز', 'حضر', 'ارفع', 'ارسل', 'راجع', 'اعتمد', 'احجز', 'اكتب', 'وقع',
  'سلم', 'اكمل', 'تاكد', 'تابع', 'جاوب', 'شارك', 'عدل', 'صحح', 'وافق',
  'انهي', 'ابدا', 'نسق', 'حدد', 'اضف', 'احذف', 'ارفق', 'نزل', 'حمل',
  'املا', 'عبي', 'اطلع', 'احضر', 'الرد', 'ردك',
  // صيغ المخاطَبة المؤنثة الشائعة في هذا القروب
  'جهزي', 'ارفعي', 'ارسلي', 'راجعي', 'اعتمدي', 'احجزي', 'اكتبي', 'وقعي',
  'سلمي', 'اكملي', 'تاكدي', 'تابعي', 'جاوبي', 'شاركي', 'عدلي', 'ارفقي',
  'ترفعين', 'ترسلين', 'تجهزين', 'تراجعين', 'تعتمدين', 'تسلمين', 'تحضرين',
  // صيغ الجمع والمضارع — «ترفعون»، «نرفع»
  'ترفعون', 'ترسلون', 'تجهزون', 'تراجعون', 'تكملون', 'تعبون', 'تعبئون',
  'تحضرون', 'تسلمون', 'تعتمدون', 'تتاكدون', 'تطلعون', 'تنسون',
  'نرفع', 'نرسل', 'نجهز', 'نراجع', 'نكمل', 'نسلم', 'نعتمد', 'نحضر',
  // صيغة الغائب بعد فاعل جماعة: «الجميع يرفع الدرجات»
  'يرفع', 'يرسل', 'يجهز', 'يراجع', 'يحضر', 'يسلم', 'يعتمد', 'يكمل',
  'يعبي', 'يطلع', 'يشارك', 'يحجز', 'يكتب', 'يوقع', 'يضيف', 'يتاكد',
];

/** لواحق تدل على أن الفعل ماضٍ فلا يكون طلبًا. */
const PAST_SUFFIXES = ['ت', 'تم', 'تها', 'ته', 'نا', 'وا', 'ها'];

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
  'صباح الخير', 'مساء الخير', 'جزاك الله', 'السلام عليكم', 'سلام عليكم',
  'وعليكم السلام', 'هلا', 'يا هلا', 'تحياتي', 'بالتوفيق', 'الله يوفقكم',
  'كل عام', 'عساكم', 'تقبل الله',
];

/**
 * ألقاب تسبق اسم الشخص. لو صدّرت الرسالة لقبًا متبوعًا باسم ليس اسمك،
 * فالطلب لذلك الشخص لا لك.
 */
const HONORIFICS = [
  'د', 'دكتور', 'دكتوره', 'ا', 'أ', 'استاذ', 'استاذه', 'م', 'مهندس',
  'مهندسه', 'شيخ', 'كابتن', 'بروفيسور', 'عميد', 'رئيس',
];

const AR_WEEKDAYS = {
  الاحد: 0, الاثنين: 1, الثلاثاء: 2, الاربعاء: 3, الخميس: 4, الجمعه: 5, السبت: 6,
};

/**
 * مطابقة عند بداية الكلمة لا في أي موضع منها.
 * المطابقة الجزئية الحرة تُنتج إيجابيات كاذبة كثيرة: «رد» تطابق «موارد»
 * و«بارد»، و«سلم» تطابق «مسلم». نسمح بالسوابق العربية الشائعة (ال، و، ب، ل)
 * فتبقى «الرد» و«وارفع» ملتقطة، وبلاحقات الكلمة كما هي.
 */
const AR_PREFIX = '(?:و|ف|ب|ل|ك)?(?:ال)?';

function has(haystack, needles) {
  const padded = ` ${haystack} `;
  return needles.some((raw) => {
    const n = normalize(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!n) return false;
    return new RegExp(`(?:^|\\s)${AR_PREFIX}${n}`, 'u').test(padded);
  });
}

/**
 * جملة خبرية يتصدّرها فاعل معرّف: «المعهد أرسل التعميم»، «العمادة اعتمدت
 * الخطة». بلا تشكيل تتطابق صورة الماضي والأمر، فنستدل بالتركيب: الطلب نادرًا
 * ما يبدأ باسم معرّف متبوعًا بفعل مباشرة.
 */
const COLLECTIVES = [
  'الجميع', 'الكل', 'الاخوه', 'الاخوان', 'الزملاء', 'الزميلات', 'الدكاتره',
  'الاعضاء', 'المشاركين', 'الحضور', 'الاساتذه', 'المدرسين', 'اعضاء',
];

function startsWithSubject(text) {
  if (!/^ال\S+\s+\S+/u.test(text)) return false;
  // «الجميع يرفع الدرجات» فاعله جماعة مخاطَبة، فالفعل بعده طلب لا خبر
  const first = text.split(' ')[0];
  return !COLLECTIVES.includes(first);
}

/** يطابق فعل طلب في صيغة غير ماضية. */
function hasVerb(haystack) {
  if (startsWithSubject(haystack)) return false;
  const padded = ` ${haystack} `;
  return VERB_SIGNALS.some((raw) => {
    const n = normalize(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = padded.match(new RegExp(`(?:^|\\s)${AR_PREFIX}(${n}\\S*)`, 'u'));
    if (!m) return false;
    const suffix = m[1].slice(normalize(raw).length);
    return !PAST_SUFFIXES.includes(suffix);
  });
}

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
  'تكفى', 'تكفي', 'تكفين', 'تكفون', 'لو سمحت', 'لو سمحتِ', 'لو سمحتي',
  'لو تكرمت', 'لو تكرمتي', 'من فضلك', 'من فضلكِ', 'الرجاء', 'رجاء',
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

  // نقشّر النداء والمجاملات المتصدّرة، بالتكرار لأنها تتراكم: "يا دكتورة عهد تكفى ..."
  for (let i = 0; i < 4; i++) {
    const before = cleaned;

    // «يا» تفتح موضع نداء، فما بعدها اسم لا كلمة عادية
    const hadVocative = /^(?:يا|ياا)\s+/u.test(cleaned);
    cleaned = cleaned.replace(/^(?:يا|ياا)\s+/u, '');

    for (const name of myNames) {
      const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // بلا نداء سابق، لا نقشّر الاسم إلا إذا تبعته فاصلة — وإلا قد يكون
      // «أحد» بمعنى «شخص ما» فنبتر جزءًا من الطلب نفسه
      const re = hadVocative
        ? new RegExp(`^${n}\\s*[،,:]?\\s*`, 'u')
        : new RegExp(`^${n}\\s*[،,:]\\s*`, 'u');
      cleaned = cleaned.replace(re, '');
    }
    for (const p of TITLE_PREFIXES) {
      // (?=\s|[،,:]|$) يمنع قشر «تكفي» من داخل «تكفين» فيبقى حرف شارد
      cleaned = cleaned.replace(new RegExp(`^${p}(?=\\s|[،,:]|$)\\s*[،,:]?\\s*`, 'u'), '');
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
 * هل نودي المستخدم باسمه؟ نشترط **موضع نداء** لا مجرد ورود الاسم، لأن
 * أسماء مثل «أحد» و«أمل» و«سند» كلمات عربية شائعة: «ممكن أحد يراجع الخطة»
 * ليست نداءً لأحد. مواضع النداء: «يا أحد» / «د. أحد» / «أحد،» / أول الرسالة.
 */
function calledByName(text, myNames) {
  const padded = ` ${text} `;
  return myNames.some((name) => {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const honorifics = HONORIFICS.join('|');
    return (
      new RegExp(`(?:^|\\s)يا\\s+(?:(?:${honorifics})\\s+)?${n}(?:\\s|$)`, 'u').test(padded) ||
      new RegExp(`(?:^|\\s)(?:${honorifics})\\s+${n}(?:\\s|$)`, 'u').test(padded) ||
      new RegExp(`^${n}\\s`, 'u').test(text) ||
      name.length >= 5 // اسم طويل مميّز لا يلتبس بكلمة عادية
    ) && padded.includes(` ${name} `);
  });
}

/**
 * هل الرسالة موجّهة صراحةً لشخص آخر؟ إشارتان:
 *   ١. اسم زميل من OTHER_NAMES ورد في النص.
 *   ٢. الرسالة تبدأ بنداء «يا …» أو بلقب متبوع باسم ليس اسمك.
 * ما عدا ذلك تُعامل كطلب جماعي — وهو الغالب في قروبات العمل.
 */
function addressedToOther(text, myNames) {
  const others = config.otherNames.map(normalize).filter((n) => n.length >= 2);
  if (others.some((n) => text.includes(n))) return true;

  const padded = ` ${text} `;
  const isMine = (token) => myNames.some((n) => n === token || n.includes(token) || token.includes(n));

  // «يا خالد ...» — الكلمة التالية للنداء اسم شخص
  const vocative = text.match(/^يا\s+(\S+)(?:\s+(\S+))?/u);
  if (vocative) {
    const [, first, second] = vocative;
    if (HONORIFICS.includes(first)) return second ? !isMine(second) : false;
    return !isMine(first);
  }

  // «د. خالد ...» أو «أستاذ سارة ...» في أول الرسالة
  const titled = text.match(/^(\S+)\s+(\S+)/u);
  if (titled && HONORIFICS.includes(titled[1])) return !isMine(titled[2]);

  // ورود لقب متبوع باسم في أي موضع: «ترسلها لـ د. خالد»
  for (const h of HONORIFICS) {
    const m = padded.match(new RegExp(`\\s${h}\\s+(\\S+)\\s`, 'u'));
    if (m && !isMine(m[1])) return true;
  }

  return false;
}

/**
 * يصنّف دفعة رسائل بالقواعد. نفس شكل مخرجات classifyBatch تمامًا،
 * حتى يقدر الـ pipeline يبدّل بين الوضعين بدون أي فرق في التعامل.
 */
export function extractByRules({ messages }) {
  const myNames = config.myNames.map(normalize).filter((n) => n.length >= 2);
  // للعناوين نحتاج الأسماء كما كتبها المستخدم لا مطبّعة، والأطول أولًا حتى
  // يُقشَّر "دكتورة عهد" كاملًا بدل أن يلتقط "عهد" وحده ويترك "دكتورة".
  const titleNames = [...config.myNames].sort((a, b) => b.length - a.length);
  const tasks = [];

  messages.forEach((msg, index) => {
    if (msg.fromMe) return; // رسائلك أنت ليست طلبات عليك

    const raw = msg.body;
    const text = normalize(raw);

    if (has(text, NOISE_SIGNALS) && text.length < 60) return;

    // الشرط الوحيد للالتقاط: فيها إشارة طلب.
    const requested = has(text, STRONG_SIGNALS) || hasVerb(text) || has(text, extraSignals);
    if (!requested) return;

    const byName = calledByName(text, myNames);
    const toMe = msg.isMention || msg.quotedFromMe || byName;

    // الاستبعاد الوحيد: موجّهة صراحةً لشخص آخر — إلا لو كنت مذكورًا معه.
    if (!toMe && addressedToOther(text, myNames)) return;

    const due = extractDue(text, raw);

    let priority = 'normal';
    if (has(text, URGENT_SIGNALS)) priority = 'urgent';
    else if (due && (due.date === today() || due.date === addDays(today(), 1))) priority = 'urgent';
    else if (has(text, HIGH_SIGNALS) || due) priority = 'high';

    // الثقة تعكس قوة الإشارة: الموجّه لك باسمك أقوى من الطلب الجماعي
    let confidence = 0.6; // طلب جماعي بلا تخصيص — الحالة الغالبة
    if (msg.isMention) confidence = 0.8;
    else if (msg.quotedFromMe) confidence = 0.75;
    else if (byName) confidence = 0.7;
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
