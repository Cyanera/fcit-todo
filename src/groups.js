import { WhatsAppClient } from './wa.js';

// يطبع القروبات التي أنت عضو فيها مع معرّفاتها، لتضعها في GROUP_JIDS.
const wa = new WhatsAppClient();
wa.on('ready', async () => {
  const groups = await wa.listGroups();
  console.log(`\n📋 عدد القروبات: ${groups.length}\n`);
  for (const g of groups.sort((a, b) => b.participants - a.participants)) {
    console.log(`  ${g.name}  —  ${g.participants} عضو`);
    console.log(`  GROUP_JIDS=${g.jid}\n`);
  }
  console.log('انسخ سطر GROUP_JIDS للقروب المطلوب وحطه في ملف .env\n');
  process.exit(0);
});
await wa.start();
