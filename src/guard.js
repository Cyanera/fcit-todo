import { isJidGroup, isJidBroadcast, isJidNewsletter, jidNormalizedUser } from 'baileys';

export class BlockedSendError extends Error {
  constructor(jid, reason) {
    super(`🚫 مُنع إرسال رسالة إلى ${jid} — ${reason}`);
    this.name = 'BlockedSendError';
    this.jid = jid;
  }
}

/**
 * حارس الإرسال — يمنع البوت من إرسال أي رسالة إلى أي قروب أو أي شخص.
 * الوجهة المسموحة الوحيدة هي محادثتك مع نفسك.
 *
 * يُركَّب على دالة `sendMessage` في المقبس نفسه لا على شيفرة الاستدعاء،
 * فيغطي كل مسار: الشيفرة الحالية، وأي شيفرة تُضاف مستقبلًا، وأي استدعاء
 * من داخل المكتبة. الفشل يكون برمي استثناء لا بتجاهل صامت، حتى يظهر
 * أي خلل في السجل بدل أن يمر دون أن يُلاحَظ.
 *
 * يُسمح استثناءً بقروب واحد تحدّده المستخدمة صراحةً في .env لاستقبال
 * الملخص اليومي. الاستثناء بمعرّف حرفي واحد لا بنمط، وكل ما عداه —
 * ومنه قروبات العمل الرسمية — يبقى ممنوعًا منعًا تامًا.
 *
 * @param sock مقبس Baileys
 * @param getSelfJid دالة ترجّع معرّفك — دالة لا قيمة، لأن المعرّف
 *        لا يُعرف إلا بعد اكتمال الاتصال
 * @param allowedGroupJid معرّف القروب المسموح، أو null فلا قروب مسموح
 */
export function installSendGuard(sock, getSelfJid, allowedGroupJid = null) {
  const rawSend = sock.sendMessage.bind(sock);

  sock.sendMessage = async (jid, content, options) => {
    if (typeof jid !== 'string' || !jid) {
      throw new BlockedSendError(String(jid), 'وجهة غير صالحة');
    }
    if (isJidGroup(jid)) {
      if (allowedGroupJid && jid === allowedGroupJid) {
        return rawSend(jid, content, options); // القروب الوحيد المصرّح به
      }
      throw new BlockedSendError(jid, 'الإرسال إلى القروبات ممنوع منعًا تامًا');
    }
    if (isJidBroadcast(jid) || isJidNewsletter(jid)) {
      throw new BlockedSendError(jid, 'الإرسال إلى القوائم والقنوات ممنوع');
    }

    const self = getSelfJid();
    if (!self) {
      throw new BlockedSendError(jid, 'لم يكتمل الاتصال بعد');
    }
    if (jidNormalizedUser(jid) !== jidNormalizedUser(self)) {
      throw new BlockedSendError(jid, 'الوجهة الوحيدة المسموحة هي محادثتك مع نفسك');
    }

    return rawSend(jid, content, options);
  };

  // نمنع استبدال الحارس بعد تركيبه
  Object.defineProperty(sock, 'sendMessage', {
    value: sock.sendMessage,
    writable: false,
    configurable: false,
  });

  return sock;
}
