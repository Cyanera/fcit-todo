import test from 'node:test';
import assert from 'node:assert/strict';
import { installSendGuard, BlockedSendError } from '../src/guard.js';

const SELF = '966544355482@s.whatsapp.net';

/** مقبس وهمي يسجّل ما وصل فعلًا إلى طبقة الإرسال الحقيقية. */
function fakeSock(selfJid = SELF) {
  const delivered = [];
  const sock = { sendMessage: async (jid, content) => { delivered.push({ jid, content }); return { ok: true }; } };
  installSendGuard(sock, () => selfJid);
  return { sock, delivered };
}

test('يمنع الإرسال إلى أي قروب', async () => {
  const { sock, delivered } = fakeSock();
  const groups = [
    '966596547883-1508011168@g.us',   // FCIT Staff
    '120363422673816082@g.us',
    '120363354430263675@g.us',
  ];
  for (const jid of groups) {
    await assert.rejects(
      () => sock.sendMessage(jid, { text: 'اختبار' }),
      BlockedSendError,
      `كان المفروض يُمنع: ${jid}`,
    );
  }
  assert.equal(delivered.length, 0, 'ما وصلت ولا رسالة لطبقة الإرسال');
});

test('يمنع الإرسال إلى شخص آخر', async () => {
  const { sock, delivered } = fakeSock();
  await assert.rejects(
    () => sock.sendMessage('966500000000@s.whatsapp.net', { text: 'مرحبا' }),
    BlockedSendError,
  );
  assert.equal(delivered.length, 0);
});

test('يمنع القوائم البريدية والقنوات والحالة', async () => {
  const { sock } = fakeSock();
  for (const jid of ['status@broadcast', '120363000000000000@newsletter']) {
    await assert.rejects(() => sock.sendMessage(jid, { text: 'x' }), BlockedSendError);
  }
});

test('يسمح فقط بمحادثتك مع نفسك', async () => {
  const { sock, delivered } = fakeSock();
  await sock.sendMessage(SELF, { text: 'تنبيه مهمة عاجلة' });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].jid, SELF);
});

test('يقبل معرّفك ولو جاء بلاحقة الجهاز', async () => {
  const { sock, delivered } = fakeSock();
  await sock.sendMessage('966544355482:12@s.whatsapp.net', { text: 'x' });
  assert.equal(delivered.length, 1);
});

test('يمنع الإرسال قبل اكتمال الاتصال', async () => {
  const sock = { sendMessage: async () => ({ ok: true }) };
  installSendGuard(sock, () => null);
  await assert.rejects(() => sock.sendMessage(SELF, { text: 'x' }), BlockedSendError);
});

test('لا يمكن استبدال الحارس بعد تركيبه', () => {
  const { sock, delivered } = fakeSock();
  // محاولة تجاوز الحارس بإعادة تعريف الدالة
  assert.throws(() => { sock.sendMessage = async () => delivered.push({ jid: 'تجاوز' }); });
  assert.equal(delivered.length, 0);
});

test('يرفض الوجهات غير الصالحة', async () => {
  const { sock } = fakeSock();
  for (const jid of [null, undefined, '', 123, {}]) {
    await assert.rejects(() => sock.sendMessage(jid, { text: 'x' }), BlockedSendError);
  }
});

const INBOX = '120363411871315380@g.us';
const OFFICIAL = '966596547883-1508011168@g.us'; // FCIT Staff

/** مقبس مع قروب واحد مصرّح به. */
function sockWithAllowed(allowed) {
  const delivered = [];
  const sock = { sendMessage: async (jid, content) => { delivered.push({ jid, content }); return { ok: true }; } };
  installSendGuard(sock, () => SELF, allowed);
  return { sock, delivered };
}

test('القروب المصرّح به وحده يُسمح — وقروبات العمل تبقى ممنوعة', async () => {
  const { sock, delivered } = sockWithAllowed(INBOX);

  await sock.sendMessage(INBOX, { text: 'ملخص الصباح' });
  assert.equal(delivered.length, 1, 'صندوق الوارد مسموح');

  await assert.rejects(() => sock.sendMessage(OFFICIAL, { text: 'x' }), BlockedSendError,
    'قروب العمل يبقى ممنوعًا');
  await assert.rejects(() => sock.sendMessage('120363422673816082@g.us', { text: 'x' }), BlockedSendError);
  assert.equal(delivered.length, 1, 'ما وصل شيء إضافي');
});

test('بلا تصريح صريح يبقى المنع تامًّا', async () => {
  const { sock, delivered } = sockWithAllowed(null);
  await assert.rejects(() => sock.sendMessage(INBOX, { text: 'x' }), BlockedSendError);
  assert.equal(delivered.length, 0);
});

test('التصريح لا يفتح الباب للأشخاص ولا القنوات', async () => {
  const { sock } = sockWithAllowed(INBOX);
  await assert.rejects(() => sock.sendMessage('966500000000@s.whatsapp.net', { text: 'x' }), BlockedSendError);
  await assert.rejects(() => sock.sendMessage('status@broadcast', { text: 'x' }), BlockedSendError);
});

test('لا تُطبع مفاتيح التشفير في السجل', async () => {
  const { isKeyDump } = await import('../src/quiet.js');
  // ما تطبعه libsignal فعلًا عند أحداث البروتوكول
  for (const m of [
    'Closing session:', 'Opening session:', 'Session already closed',
    'Removing old closed session:', 'Migrating session to:',
  ]) {
    assert.ok(isKeyDump(m), `كان المفروض يُكتم: ${m}`);
  }
  // ولا نكتم رسائلنا ولا الأخطاء الحقيقية
  for (const m of ['✅ متصل بواتساب', '⚠️ انقطع الاتصال', 'Error: something broke']) {
    assert.equal(isKeyDump(m), false, `كُتم خطأً: ${m}`);
  }
});
