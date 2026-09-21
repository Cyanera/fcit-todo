/**
 * كتم تفريغ مفاتيح التشفير في الطرفية.
 *
 * مكتبة `libsignal` — التي تعتمد عليها Baileys — تطبع كائن الجلسة كاملًا
 * عبر `console.info` عند أحداث بروتوكول روتينية، والكائن يحوي
 * `privKey` و`rootKey` نصًّا صريحًا. هذا يلوّث الطرفية، والأخطر أنه ينتهي
 * في ملف سجل على القرص عند التشغيل عبر launchd أو أي مشرف عمليات.
 *
 * المكتبة لا تقبل logger مخصصًا لهذه الاستدعاءات، وتعديل node_modules
 * يضيع مع أول تثبيت، فنرشّح الرسائل المعروفة عند مستوى console.
 * الترشيح بمطابقة بدايات محددة حرفيًا حتى لا نكتم خطأ حقيقيًا.
 */

const SIGNAL_KEY_DUMPS = [
  'Closing session:',
  'Opening session:',
  'Session already closed',
  'Session already open',
  'Removing old closed session:',
  'Migrating session to:',
  'Closing open session in favor of incoming prekey bundle',
];

let installed = false;

export function silenceSignalKeyDumps() {
  if (installed) return;
  installed = true;

  for (const level of ['info', 'warn', 'log']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const first = args[0];
      if (typeof first === 'string' && SIGNAL_KEY_DUMPS.some((p) => first.startsWith(p))) {
        return; // حدث بروتوكول روتيني، ولا قيمة له للمستخدم
      }
      original(...args);
    };
  }
}

/** للاختبار: هل هذه الرسالة من النوع المكتوم؟ */
export function isKeyDump(message) {
  return typeof message === 'string' && SIGNAL_KEY_DUMPS.some((p) => message.startsWith(p));
}
