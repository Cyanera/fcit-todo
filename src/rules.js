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
  // المصادر: كثيرًا ما يُصاغ الطلب اسمًا لا فعلًا — «تعبئة هذا الرابط»
  'تعبئه', 'تجهيز', 'مراجعه', 'اعتماد', 'تحديث', 'ارسال', 'استكمال',
  'تسجيل', 'ترشيح', 'توقيع', 'اعداد', 'رفع الدرجات', 'التسجيل',
  // الإنجليزية — كثير من تعاميم الجامعة والقروبات المهنية تأتي بها
  'نامل منكم', 'نامل', 'نرجو منكم', 'نرجو', 'يرجى', 'يرجي', 'التكرم',
  'بضروره', 'نفيدكم', 'نحيطكم', 'عليه نامل', 'وعليه',
  'please', 'kindly', 'required', 'needed', 'must', 'deadline', 'due date',
  'reminder', 'dont forget', 'do not forget', 'asap', 'make sure',
  'we need', 'you need', 'is due', 'no later than',
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
  // عاميّة خليجية — كانت ناقصة بالكامل
  'جيب', 'جيبي', 'جيبوا', 'هات', 'هاتي', 'خذ', 'خذي', 'سوي', 'سووا',
  'اشتر', 'اشتري', 'ودي', 'كلم', 'كلمي', 'اتصل', 'اتصلي',
  'شوف', 'شوفي', 'رتب', 'رتبي', 'نظم', 'ادفع', 'ادفعي',
  'وصلي', 'استلم', 'استلمي',
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
  // أفعال الطلب بالإنجليزية
  'send', 'submit', 'upload', 'review', 'prepare', 'complete', 'fill',
  'sign', 'book', 'share', 'update', 'confirm', 'attend', 'register',
  'approve', 'attach', 'download', 'finish', 'provide', 'reply',
  'schedule', 'arrange', 'coordinate', 'verify', 'check',
];

/** لواحق تدل على أن الفعل ماضٍ فلا يكون طلبًا. */
const PAST_SUFFIXES = ['ت', 'تم', 'تها', 'ته', 'نا', 'وا', 'ها'];

/** إشارات استعجال ترفع الأولوية إلى urgent. */
const URGENT_SIGNALS = [
  'عاجل', 'ضروري', 'مستعجل', 'بسرعه', 'بسرعة', 'اليوم', 'الحين', 'حالا',
  'فورا', 'الان', 'قبل نهايه اليوم', 'مهم جدا',
  'urgent', 'asap', 'today', 'immediately', 'right now', 'very important',
];

/** إشارات تُعلي الأولوية إلى high دون أن تجعلها عاجلة. */
const HIGH_SIGNALS = [
  'مهم', 'موعد', 'تسليم', 'ديدلاين', 'اخر موعد', 'العماده', 'الرئيس', 'المدير',
  'important', 'deadline', 'due', 'dean', 'director',
];

/** عبارات تنفي أن تكون الرسالة طلبًا — شكر ومجاملات وردود قصيرة. */
const NOISE_SIGNALS = [
  'شكرا', 'مشكور', 'يعطيك العافيه', 'تسلم', 'الله يعافيك', 'ابشر',
  'تم بالفعل', 'خلاص تم', 'وصل', 'مبروك', 'حياك', 'اهلا', 'مرحبا',
  'صباح الخير', 'مساء الخير', 'جزاك الله', 'السلام عليكم', 'سلام عليكم',
  'وعليكم السلام', 'هلا', 'يا هلا', 'تحياتي', 'بالتوفيق', 'الله يوفقكم',
  'كل عام', 'عساكم', 'تقبل الله',
  // الإنجليزية
  'thanks', 'thank you', 'good morning', 'good evening', 'hello', 'hi ',
  'welcome', 'congrats', 'congratulations', 'well done', 'noted', 'ok ',
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

/**
 * يستخرج الروابط من نص الرسالة. تعاميم الجامعة كثيرًا ما تحمل رابط
 * نموذج أو ملف، وهو أول ما يُحتاج عند التنفيذ.
 */
export function extractLinks(raw) {
  const found = raw.match(/https?:\/\/[^\s<>"'\u0600-\u06FF]+/gu) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,،؛;:)\]]+$/, '')))];
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

  const EN_WEEKDAYS = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  for (const [name, target] of Object.entries(EN_WEEKDAYS)) {
    if (!word(name)) continue;
    const current = new Date(`${base}T12:00:00Z`).getUTCDay();
    let diff = (target - current + 7) % 7;
    if (diff === 0) diff = 7;
    return { date: addDays(base, diff), text: name };
  }
  if (word('day after tomorrow')) return { date: addDays(base, 2), text: 'بعد بكرة' };
  if (word('tomorrow')) return { date: addDays(base, 1), text: 'بكرة' };
  if (word('today')) return { date: base, text: 'اليوم' };

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

/** الكلمات الإضافية التي يضيفها المستخدم في RULE_KEYWORDS. */
const extraSignals = config.ruleKeywords;

/** مجاملات تتصدّر الطلب ولا تضيف معنى للعنوان. */
const TITLE_PREFIXES = [
  'تكفى', 'تكفي', 'تكفين', 'تكفون', 'لو سمحت', 'لو سمحتِ', 'لو سمحتي',
  'لو تكرمت', 'لو تكرمتي', 'من فضلك', 'من فضلكِ', 'الرجاء', 'رجاء',
  'ارجو', 'أرجو', 'ممكن', 'بليز', 'اذا ممكن', 'إذا ممكن', 'عفوا', 'عفوًا',
  'please', 'kindly', 'pls', 'plz', 'could you', 'can you', 'would you',
  'reminder', 'note', 'fyi',
  // صيغ التعاميم الرسمية
  'نأمل منكم', 'نامل منكم', 'نأمل', 'نامل', 'نرجو منكم', 'نرجو',
  'يرجى', 'يُرجى', 'يرجي', 'التكرم', 'بضرورة', 'بضروره', 'وعليه',
  'تعميم', 'إعلان', 'اعلان', 'تنويه', 'للعلم', 'هام', 'مهم',
];

/**
 * عبارات الموعد والاستعجال في ذيل الطلب. تُقصّ من العنوان لأن اللوحة
 * تعرضهما في شريحتين مستقلتين، فتكرارهما في العنوان حشو يطمس المطلوب.
 */
const TAIL_NOISE = [
  'عاجلا', 'عاجل', 'ضروري', 'بسرعة', 'بسرعه', 'حالا', 'فورا', 'الحين',
  'الان', 'باسرع وقت', 'بأسرع وقت', 'اليوم', 'بكرة', 'بكره', 'غدا', 'غدًا',
  'بعد بكرة', 'بعد بكره', 'نهاية الاسبوع', 'نهاية الأسبوع', 'هذا الاسبوع',
  'asap', 'urgent', 'today', 'tomorrow', 'immediately', 'right now',
  'this week', 'next week',
  // إشارات إلى الرابط — الرابط نفسه صار في الوصف
  'عبر الرابط', 'على الرابط', 'من خلال الرابط', 'عبر الرابط التالي',
  'الرابط التالي', 'الرابط أدناه', 'الرابط ادناه', 'التالي', 'أدناه', 'ادناه',
  'here', 'below', 'at this link', 'via this link', 'link',
];

/** يحوّل كلمة إلى نمط يتسامح مع اختلاف الهمزة والتاء المربوطة. */
function tolerant(word) {
  return word
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[اأإآ]/g, '[اأإآ]')
    .replace(/[هة]/g, '[هة]')
    .replace(/[يى]/g, '[يى]')
    .replace(/\s+/g, '\\s+');
}

/** يقصّ عبارات الموعد والاستعجال من ذيل العنوان. */
function trimTail(text) {
  let out = text;
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = out.replace(/[\s،,:;.!؟-]+$/u, '');

    // ذيل الموعد كاملًا مهما طال: «خلال هذا الأسبوع، وبحد أقصى نهاية دوام الخميس»
    out = out.replace(
      /\s*[،,]?\s*(?:و?بحد\s+أقصى|و?بحد\s+اقصى|خلال|في\s+موعد\s+أقصاه|قبل|بحلول|حتى\s+نهاية|لا\s+يتجاوز|before|by|no\s+later\s+than|due\s+on)(?=\s).*$/iu,
      '',
    );

    for (const w of TAIL_NOISE) {
      out = out.replace(new RegExp(`\\s+${tolerant(w)}$`, 'iu'), '');
    }

    // أداة ربط معلّقة بعد قصّ الموعد: «deadline for grades is»
    out = out.replace(
      /\s+(?:is|are|was|were|will\s+be|on|by|at|in|to|for|في|على|الى|إلى|يوم)$/iu,
      '',
    );

    if (out === before) break;
  }
  // لو القصّ أفنى الطلب، نُبقي الأصل
  return out.trim().length >= 6 ? out.trim() : text;
}

/**
 * التعاميم الرسمية تبدأ بتحية ومخاطَبة، والطلب مدفون في فقرة لاحقة،
 * وتنتهي بشكر. أخذُ أول سطر يعطي «السلام عليكم ورحمة الله وبركاته».
 * نختار الفقرة التي تحمل إشارة الطلب فعلًا.
 */
function pickRequestSegment(raw) {
  const segments = raw
    .split(/\n+|(?<=[.!؟])\s+/u)
    .map((s) => s.replace(/\*+/g, '').trim()) // تنسيق واتساب العريض
    .filter((s) => s.length > 3);

  if (segments.length <= 1) return raw;

  const substantive = segments.filter((seg) => {
    const n = normalize(seg);
    if (has(n, NOISE_SIGNALS) && seg.length < 80) return false; // تحية أو شكر
    if (/^https?:\/\//.test(seg.trim())) return false; // سطر رابط وحده
    return true;
  });

  // الأفضل: فقرة تحمل إشارة طلب صريحة
  for (const seg of substantive) {
    const n = normalize(seg);
    if (has(n, STRONG_SIGNALS) || hasVerb(n) || has(n, extraSignals)) return seg;
  }

  // وإلا — وهذا حال وضع الوارد حيث لا نبحث عن إشارة — أول فقرة ذات معنى
  return substantive.find((s) => s.length > 12) ?? substantive[0] ?? raw;
}

/**
 * عنوان مختصر من نص الرسالة. القواعد ما تقدر تعيد الصياغة مثل النموذج،
 * لكنها تقدر تختار فقرة الطلب وتشيل النداء والمجاملة والموعد.
 */
function toTitle(rawFull, myNames) {
  const raw = pickRequestSegment(rawFull);
  let cleaned = raw
    .replace(/https?:\/\/\S+/g, '') // الرابط في الوصف لا في العنوان
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
      cleaned = cleaned.replace(new RegExp(`^${p}(?=\\s|[،,:]|$)\\s*[،,:]?\\s*`, 'iu'), '');
    }

    if (cleaned === before) break;
  }

  cleaned = trimTail(cleaned.replace(/^[،,:\s-]+/, '').trim());
  // لو القشر أكل الجملة كلها، نرجع للنص الأصلي
  if (cleaned.length < 8) cleaned = raw.replace(/@\d+/g, '').replace(/\s+/g, ' ').trim();

  if (cleaned.length <= 70) return cleaned;

  // نقصّ عند أقرب فاصل جملة بدل بتر الكلمة
  const cut = cleaned.slice(0, 70);
  const lastBreak = Math.max(cut.lastIndexOf('،'), cut.lastIndexOf('.'), cut.lastIndexOf(' '));
  return `${cut.slice(0, lastBreak > 30 ? lastBreak : 70).trim()}…`;
}

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
/**
 * وضع صندوق الوارد: كل رسالة مهمة بحكم وصولها — المستخدمة حوّلتها بنفسها.
 * لا نخمّن «هل هذا طلب؟»، بل نستخلص: ما المطلوب، وروابطه، وموعده.
 */
/** هل الرسالة روابط وحدها بلا نص ذي معنى؟ */
function isLinkOnly(raw, links) {
  if (!links.length) return false;
  const rest = links.reduce((s, u) => s.replace(u, ' '), raw);
  // ما تبقّى بعد نزع الروابط: علامات أو كلمة إشارة قصيرة («الرابط:»)
  return normalize(rest).length <= 12;
}

function extractInbox(messages) {
  const titleNames = [...config.myNames].sort((a, b) => b.length - a.length);
  const tasks = [];
  const orphanLinks = []; // روابط وصلت قبل أي مهمة في هذه الدفعة

  messages.forEach((msg, index) => {
    const raw = (msg.body ?? '').trim();
    // الاستثناء الوحيد: رسالة فارغة أو إيموجي وحده — لا مهمة فيها
    if (normalize(raw).length < 3) return;

    const text = normalize(raw);
    const links = extractLinks(raw);

    // المحتوى المحوّل يصل كثيرًا على رسالتين: النص ثم الرابط وحده.
    // الرابط المفرد تكملةٌ لما قبله لا مهمة مستقلة.
    if (isLinkOnly(raw, links)) {
      const previous = tasks[tasks.length - 1];
      if (previous) {
        previous.details = [previous.details, ...links].filter(Boolean).join('\n');
      } else {
        orphanLinks.push(...links); // سابقتها في دفعة مضت — يتولّاها الـ pipeline
      }
      return;
    }
    const due = extractDue(text, raw);

    let priority = 'normal';
    if (has(text, URGENT_SIGNALS)) priority = 'urgent';
    else if (due && (due.date === today() || due.date === addDays(today(), 1))) priority = 'urgent';
    else if (has(text, HIGH_SIGNALS) || due) priority = 'high';

    // الوصف يحمل ما يلزم للتنفيذ: الروابط أولًا ثم نص الموعد كما ورد
    // الوصف للروابط وحدها؛ الموعد له شريحته والنص الأصلي بضغطة
    const details = links.join('\n');

    tasks.push({
      message_index: index,
      title: toTitle(raw, titleNames),
      details,
      requester: msg.sender_name ?? '',
      due_date: due?.date ?? '',
      due_text: due?.text ?? '',
      priority,
      confidence: 1, // وصولها للصندوق هو التأكيد
    });
  });

  return { tasks, orphanLinks, usage: null, mode: 'inbox' };
}

export function extractByRules({ messages }) {
  if (config.inboxMode) return extractInbox(messages);

  const myNames = config.myNames.map(normalize).filter((n) => n.length >= 2);
  // للعناوين نحتاج الأسماء كما كتبها المستخدم لا مطبّعة، والأطول أولًا حتى
  // يُقشَّر "دكتورة عهد" كاملًا بدل أن يلتقط "عهد" وحده ويترك "دكتورة".
  const titleNames = [...config.myNames].sort((a, b) => b.length - a.length);
  const tasks = [];

  messages.forEach((msg, index) => {
    // رسائلك أنت ليست طلبات عليك عادةً — إلا إذا فُعّل INCLUDE_OWN_MESSAGES
    if (msg.fromMe && !config.includeOwnMessages) return;

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
