import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * تنبيه عند تعديل الشيفرة والبوت يعمل.
 *
 * Node يحمّل الوحدات مرة واحدة عند الإقلاع، فأي تعديل بعده لا يسري حتى
 * إعادة التشغيل. هذا يُنتج عطلًا خفيًا: تظنّ الإصلاح ساريًا وهو ليس كذلك —
 * وقد حدث فعلًا مع إصلاح منع عودة المهام المحذوفة، فحُذفت مهام بلا شواهد
 * لأن النسخة العاملة كانت أقدم من الإصلاح بدقيقة.
 *
 * نفحص بصمة ملفات المصدر دوريًا ونطبع تحذيرًا واضحًا عند اختلافها.
 */

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function fingerprint() {
  const hash = crypto.createHash('sha1');
  for (const name of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort()) {
    const { mtimeMs, size } = fs.statSync(path.join(srcDir, name));
    hash.update(`${name}:${mtimeMs}:${size}`);
  }
  return hash.digest('hex');
}

/** يبدأ المراقبة. يرجّع دالة لإيقافها. */
export function watchSourceFreshness(intervalMs = 60_000) {
  const atStartup = fingerprint();
  let warned = false;

  const timer = setInterval(() => {
    if (warned || fingerprint() === atStartup) return;
    warned = true; // مرة واحدة تكفي — لا نُغرق السجل
    console.warn(
      '\n⚠️  تغيّرت شيفرة المشروع بعد تشغيل البوت.\n' +
        '   النسخة العاملة ما زالت القديمة — أي إصلاح جديد غير سارٍ.\n' +
        '   أعِد التشغيل: Ctrl+C ثم npm start\n',
    );
  }, intervalMs);

  timer.unref?.(); // لا يمنع الخروج
  return () => clearInterval(timer);
}
