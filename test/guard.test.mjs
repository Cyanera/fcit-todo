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
