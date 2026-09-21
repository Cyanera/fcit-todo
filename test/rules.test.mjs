import test from 'node:test';
import assert from 'node:assert/strict';

// نضبط الهوية قبل تحميل الوحدة لأن config يقرأ البيئة عند الاستيراد
process.env.MY_NAMES = 'عهد,د. عهد,دكتورة عهد,Ahad';
process.env.OTHER_NAMES = 'خالد,سارة,فهد,منى';
process.env.MODE = 'rules';
process.env.MIN_CONFIDENCE = '0.6';

const { extractByRules } = await import('../src/rules.js');

/** يشغّل المستخرج على رسالة واحدة ويرجّع المهمة أو null. */
function run(body, { isMention = false, quotedFromMe = false } = {}) {
  const { tasks } = extractByRules({
    messages: [{ sender_name: 'زميل', fromMe: false, isMention, quotedFromMe, body }],
  });
  return tasks[0] ?? null;
}

test('يلتقط المهام الجماعية — وهي الغالبة في قروبات العمل', () => {
  const captured = [
    'لازم نرفع درجات أعمال السنة قبل الخميس',
    'مطلوب من الجميع تعبئة نموذج الجودة',
    'ممكن أحد يراجع خطة المقرر؟',
    'تذكير: آخر موعد لتسليم التقارير بكرة',
    'الرجاء الاطلاع على التعميم والرد عليه',
    'ضروري الجميع يحضر اجتماع القسم اليوم',
    'لا تنسون ترفعون الخطط على النظام',
    'الجميع يرفع الدرجات قبل نهاية الأسبوع',
  ];
  for (const body of captured) {
    assert.ok(run(body), `كان المفروض تُلتقط: ${body}`);
  }
});

test('يستبعد ما هو موجّه لزميل بالاسم', () => {
  const excluded = [
    'د. خالد ممكن ترفع الدرجات؟',
    'يا فهد تكفى جهّز القاعة',
    'سارة لازم تراجعين التقرير',
  ];
  for (const body of excluded) {
    assert.equal(run(body), null, `كان المفروض تُستبعد: ${body}`);
  }
});

test('يلتقط الموجّه لك بثقة أعلى من الجماعي', () => {
  const group = run('لازم نرفع الدرجات قبل الخميس');
  const mention = run('لا تنسى ترفع الدرجات اليوم', { isMention: true });
  const named = run('يا عهد تكفى جهّز أسئلة النهائي بكرة');

  assert.ok(mention.confidence > group.confidence);
  assert.ok(named.confidence > group.confidence);
});

test('يذكر أنك ضمن عدة أشخاص فلا يُستبعد', () => {
  assert.ok(run('د. خالد و د. عهد لازم تعتمدون الخطة'));
});

test('يتجاهل التحيات والشكر والإعلانات', () => {
  const noise = [
    'السلام عليكم ورحمة الله',
    'شكرًا للجميع على الجهود',
    'صباح الخير',
    'الاجتماع بكرة الساعة ١٠ في القاعة',
    'مبروك الترقية دكتور',
  ];
  for (const body of noise) {
    assert.equal(run(body), null, `كان المفروض يُتجاهل: ${body}`);
  }
});

test('لا يطابق جزءًا من كلمة — «رد» ليست «موارد»', () => {
  const falsePositives = [
    'الجو بارد اليوم',
    'كل مسلم يعرف هذا',
    'التردد على المكتب صعب',
    'الحمد لله على كل حال',
  ];
  for (const body of falsePositives) {
    assert.equal(run(body), null, `إيجابية كاذبة: ${body}`);
  }
});

test('يميّز الماضي من الأمر: «أرسلت التعميم» خبر لا طلب', () => {
  assert.equal(run('الموارد البشرية أرسلت التعميم'), null);
  assert.equal(run('المعهد أرسل التعميم للجميع'), null);
  assert.ok(run('أرسل التعميم للجميع'), 'صيغة الأمر تبقى ملتقطة');
});

test('اسم «عهد» لا يُحسب نداءً في المعهد وولي العهد', () => {
  // ورود الاسم داخل كلمة أو في سياق غير النداء لا يرفع الثقة ولا يبتر العنوان
  assert.equal(run('اجتماع في مبنى المعهد بكرة'), null);
  assert.equal(run('هذا من ولي العهد حفظه الله'), null);
});

test('يقبل الفاصلة العربية في قوائم .env', async () => {
  // من يكتب أسماء عربية يستخدم لوحة مفاتيح عربية، فالفاصلة تكون «،» لا «,»
  const before = process.env.OTHER_NAMES;
  process.env.OTHER_NAMES = 'نورة،سهام،رضوانة';
  const fresh = await import(`../src/config.js?v=${Math.random()}`);
  assert.deepEqual(fresh.config.otherNames, ['نورة', 'سهام', 'رضوانة']);
  process.env.OTHER_NAMES = before;
});

test('يقشّر المجاملة ككلمة كاملة لا كجزء منها', () => {
  // «تكفي» كانت تُقشَّر من داخل «تكفين» فيبقى حرف «ن» شاردًا
  assert.equal(run('يا عهد تكفين جهزي أسئلة النهائي').title, 'جهزي أسئلة النهائي');
});

test('يفهم صيغ الأمر المؤنثة', () => {
  assert.ok(run('ارفعي الدرجات على النظام'));
  assert.ok(run('الجميع يجهز الملفات'));
});

test('يفهم العاميّة الخليجية وصيغة المصدر', () => {
  // حالات حقيقية من تجربة المستخدمة — كانت كلها تفوت
  assert.ok(run('ارسل الصور قبل يوم الخميس'));
  assert.ok(run('جيب المقاضي من البقالة اليوم'), '«جيب» عاميّة كانت ناقصة');
  assert.ok(run('تعبئة هذا الرابط عاجلا :'), 'الطلب مصدرًا لا فعلًا');
});

test('لا يلتقط الكلمات الملتبسة بالعاميّة', () => {
  // «روح» و«زور» و«حول» و«وصل» أُزيلت لأن معانيها العادية أشيع من الطلب
  for (const body of [
    'روح الفريق عالية',
    'شهادة زور ما نقبلها',
    'حول هذا الموضوع عندي ملاحظة',
    'وصل الملف شكرًا',
    'الود موجود بيننا',
  ]) {
    assert.equal(run(body), null, `إيجابية كاذبة: ${body}`);
  }
});

test('يتجاهل رسائلك أنت إلا بتفعيل INCLUDE_OWN_MESSAGES', async () => {
  // config كائن مشترك، وإعادة استيراد rules.js لا تُنشئ نسخة جديدة منه،
  // فنبدّل القيمة عليه مباشرة — وهذا يختبر المسار الفعلي نفسه
  const { config } = await import('../src/config.js');
  const own = { sender_name: 'أنا', fromMe: true, isMention: false, quotedFromMe: false,
                body: 'ارسل الصور قبل يوم الخميس' };

  assert.equal(config.includeOwnMessages, false, 'الافتراضي معطّل');
  assert.equal(extractByRules({ messages: [own] }).tasks.length, 0, 'الافتراضي يتجاهلها');

  config.includeOwnMessages = true;
  try {
    assert.equal(extractByRules({ messages: [own] }).tasks.length, 1, 'بالتفعيل تُلتقط');
  } finally {
    config.includeOwnMessages = false;
  }
});

test('يحوّل المواعيد النسبية إلى تواريخ فعلية', () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  assert.equal(run('لازم ترفع الدرجات اليوم').due_date, today);
  assert.equal(run('لازم ترفع الدرجات بكرة').due_date, tomorrow.toISOString().slice(0, 10));
  assert.equal(run('لازم تعتمد الخطة قبل 2026-10-05').due_date, '2026-10-05');
  assert.ok(run('لازم نسلم التقرير الخميس').due_date, 'أسماء الأيام تُحوَّل');
});

test('الاستعجال والموعد القريب يرفعان الأولوية', () => {
  assert.equal(run('ضروري ترفع الدرجات').priority, 'urgent');
  assert.equal(run('لازم ترفع الدرجات اليوم').priority, 'urgent');
  assert.equal(run('مطلوب تعبئة النموذج').priority, 'normal');
});

test('العنوان ينظَّف من النداء والمجاملة', () => {
  assert.equal(run('يا عهد تكفى جهّز أسئلة النهائي').title, 'جهّز أسئلة النهائي');
  // «أحد» هنا بمعنى «شخص ما» فلا تُبتر من العنوان
  assert.match(run('ممكن أحد يراجع خطة المقرر؟').title, /أحد يراجع/);
});
