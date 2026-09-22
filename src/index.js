import { config, activeMode, hasRealKey } from './config.js';
import { WhatsAppClient } from './wa.js';
import { Pipeline } from './pipeline.js';
import { startServer } from './server.js';
import { acquireLock } from './lock.js';
import { watchSourceFreshness } from './freshness.js';
import { startRecurring, loadSchedule } from './recurring.js';

function preflight() {
  const mode = activeMode();

  if (config.inboxMode) {
    console.log('\n📥 وضع صندوق الوارد — كل رسالة تصل = مهمة.');
    console.log('   حوِّلي رسائل القروبات الرسمية إلى هذا القروب، والبوت');
    console.log('   يستخلص المطلوب والروابط وموعد التسليم. لا يقرأ أي قروب آخر.');
    console.log('   الاستثناء الوحيد: رسالة فارغة أو إيموجي وحده.');
  } else if (mode === 'rules') {
    console.log('\n🔤 وضع القواعد — بدون Claude وبدون أي تكلفة.');
    console.log('   يلتقط أي رسالة فيها إشارة طلب، جماعية كانت أو باسمك.');
    console.log(
      `   يستبعد ما هو موجّه لزميل بالاسم${
        config.otherNames.length ? ` (${config.otherNames.length} اسمًا مضبوطًا)` : ' — OTHER_NAMES فاضي'
      }، والتحيات والشكر.`,
    );
    console.log('   يفوته الطلب الضمني بلا صيغة طلب واضحة.');
    if (!hasRealKey()) {
      console.log('   أضف ANTHROPIC_API_KEY في .env وينتقل للتصنيف الذكي تلقائيًا.');
    }
  } else {
    console.log(`\n🧠 وضع التصنيف الذكي — ${config.model}`);
  }

  const problems = [];
  if (!config.myNames.length) {
    problems.push(
      mode === 'rules'
        ? 'MY_NAMES فاضي — وضع القواعد يعتمد عليه، وبدونه ما راح يلتقط إلا المنشن الصريح'
        : 'MY_NAMES فاضي — التصنيف راح يكون ضعيف بدونه',
    );
  }
  if (!config.groupJids.length) {
    problems.push('GROUP_JIDS فاضي — سيقرأ كل القروبات. شغّل npm run groups لتحديد قروب معيّن');
  }
  if (config.mode === 'claude' && !hasRealKey()) {
    console.error('\n❌ MODE=claude لكن ANTHROPIC_API_KEY غير صالح في .env');
    process.exit(1);
  }

  if (problems.length) {
    console.warn('\n⚠️  تنبيهات الإعداد:');
    for (const p of problems) console.warn(`   • ${p}`);
  }
  console.warn('');
}

async function main() {
  acquireLock(); // قبل أي اتصال: نسخة واحدة فقط
  preflight();

  const wa = new WhatsAppClient();
  const pipeline = new Pipeline(wa);

  wa.on('message', (msg) => pipeline.add(msg));
  wa.on('replaced', () => process.exit(1));
  wa.on('ready', () => {
    pipeline.startDigestTimer();
    pipeline.resumePending();
  });

  await wa.start();
  await startServer({ wa, pipeline });
  watchSourceFreshness();

  const schedule = loadSchedule();
  if (schedule) {
    console.log(
      `🔁 مهام دورية: ${schedule.tasks.length} مادة، تُضاف قبل موعدها بـ${schedule.leadDays} يوم.`,
    );
    startRecurring();
  }

  const shutdown = async () => {
    console.log('\n⏹️  إيقاف... معالجة ما تبقّى في الطابور.');
    await pipeline.flush().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('فشل التشغيل:', err);
  process.exit(1);
});
