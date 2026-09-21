import { WhatsAppClient } from './wa.js';

// تسجيل دخول فقط: يعرض QR، ويخرج بمجرد نجاح الربط.
const wa = new WhatsAppClient();
wa.on('ready', () => {
  console.log('\n✅ تم الربط. الجلسة محفوظة في data/wa-auth');
  console.log('   الخطوة التالية: npm run groups لمعرفة معرّف القروب.\n');
  setTimeout(() => process.exit(0), 1500);
});
await wa.start();
