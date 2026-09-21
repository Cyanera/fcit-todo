import { config } from './config.js';
import { WhatsAppClient } from './wa.js';
import { Pipeline } from './pipeline.js';
import { startServer } from './server.js';

function preflight() {
  const problems = [];
  if (!config.anthropicKey) problems.push('ANTHROPIC_API_KEY غير مضبوط في ملف .env');
  if (!config.myNames.length) problems.push('MY_NAMES فاضي — التصنيف راح يكون ضعيف بدونه');
  if (!config.groupJids.length)
    problems.push('GROUP_JIDS فاضي — سيقرأ كل القروبات. شغّل npm run groups لتحديد قروب معيّن');

  if (problems.length) {
    console.warn('\n⚠️  تنبيهات الإعداد:');
    for (const p of problems) console.warn(`   • ${p}`);
    console.warn('');
  }
  if (!config.anthropicKey) process.exit(1);
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
