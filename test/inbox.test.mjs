import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INBOX_MODE = 'true';
process.env.MY_NAMES = 'عهد,د. عهد';
process.env.MODE = 'rules';

const { extractByRules, extractLinks } = await import('../src/rules.js');

/** رسالة محوّلة — المستخدمة هي المُرسِلة، وهذا هو الأصل في هذا الوضع. */
function forward(body) {
  const { tasks } = extractByRules({
    messages: [{ sender_name: 'عهد', fromMe: true, isMention: false, quotedFromMe: false, body }],
  });
  return tasks[0] ?? null;
}

test('كل رسالة محوّلة تصير مهمة بلا تخمين', () => {
  // رسائل لا تحمل أي إشارة طلب — في الوضع العادي تُستبعد، وهنا تُقبل
  for (const body of [
    'اجتماع مجلس القسم يوم الثلاثاء الساعة 10 صباحًا',
    'تم اعتماد الخطة الدراسية الجديدة للفصل القادم',
    'قائمة الطلاب المتعثرين في المرفقات',
  ]) {
    assert.ok(forward(body), `كان المفروض تصير مهمة: ${body}`);
  }
});

test('الاستثناء الوحيد: الفارغ والإيموجي', () => {
  for (const body of ['👍', '', '   ', '🙏🙏']) {
    assert.equal(forward(body), null, `ما تصير مهمة: "${body}"`);
  }
});

test('يستخلص الروابط إلى الوصف وينزعها من العنوان', () => {
  const task = forward(
    'يرجى تعبئة نموذج التقييم عبر الرابط\nhttps://forms.office.com/r/abc123XYZ\nآخر موعد الأحد',
  );
  assert.ok(task.details.includes('https://forms.office.com/r/abc123XYZ'), 'الرابط في الوصف');
  assert.ok(!task.title.includes('http'), 'لا رابط في العنوان');
  assert.equal(task.title, 'تعبئة نموذج التقييم');
});

test('يستخلص أكثر من رابط بلا تكرار', () => {
  const links = extractLinks(
    'النموذج https://a.example/form والدليل https://b.example/guide.pdf ومرة ثانية https://a.example/form',
  );
  assert.deepEqual(links, ['https://a.example/form', 'https://b.example/guide.pdf']);
});

test('ينظّف علامات الترقيم الملتصقة بالرابط', () => {
  assert.deepEqual(extractLinks('الرابط: https://uj.edu.sa/form.pdf.'), ['https://uj.edu.sa/form.pdf']);
  assert.deepEqual(extractLinks('(https://uj.edu.sa/a)'), ['https://uj.edu.sa/a']);
});

test('يستخلص موعد التسليم ويرفع الأولوية', () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  assert.equal(forward('تسليم التقرير اليوم').due_date, today);
  assert.equal(forward('تسليم التقرير اليوم').priority, 'urgent');
  assert.ok(forward('يرجى الرفع قبل يوم الخميس').due_date, 'أسماء الأيام');
  assert.equal(forward('اجتماع القسم').priority, 'normal', 'بلا موعد ولا استعجال');
});

test('التعميم الطويل: العنوان من فقرة الطلب', () => {
  const task = forward(`السلام عليكم ورحمة الله وبركاته،

الزملاء والزميلات منسقي المقررات،
نأمل منكم التكرم بضرورة **الانتهاء من استكمال ملفات المقررات خلال هذا الأسبوع، وبحد أقصى نهاية دوام يوم الخميس**.

مع خالص الشكر والتقدير.`);

  assert.equal(task.title, 'الانتهاء من استكمال ملفات المقررات');
  assert.ok(task.due_date, 'الموعد يُستخرج');
  assert.equal(task.priority, 'urgent');
});

test('الثقة كاملة — وصول الرسالة هو التأكيد', () => {
  assert.equal(forward('اجتماع مجلس القسم الثلاثاء').confidence, 1);
});
