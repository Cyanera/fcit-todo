import { config, activeMode, hasRealKey } from './config.js';
import { WhatsAppClient } from './wa.js';
import { Pipeline } from './pipeline.js';
import { startServer } from './server.js';

function preflight() {
  const mode = activeMode();

  if (mode === 'rules') {
    console.log('\n🔤 وضع القواعد — بدون Claude وبدون أي تكلفة.');
    console.log('   يلتقط الرسائل الموجّهة لك (منشن / رد عليك / نداء باسمك)');
    console.log('   والتي فيها إشارة طلب واضحة. الطلبات غير المباشرة راح تفوته.');
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
  preflight();

  const wa = new WhatsAppClient();
  const pipeline = new Pipeline(wa);

  wa.on('message', (msg) => pipeline.add(msg));
  wa.on('ready', () => pipeline.startDigestTimer());

  await wa.start();
  await startServer({ wa, pipeline });

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
