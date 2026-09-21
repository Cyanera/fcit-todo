import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * قفل نسخة واحدة.
 *
 * تشغيل نسختين بنفس اعتماد واتساب يجعلهما تتقاتلان: كل واحدة تزيح
 * الأخرى (رمز 440) فتعيد المُزاحة الاتصال فتزيح الأولى، بلا نهاية.
 * وتكتبان في نفس قاعدة البيانات معًا. المنع أولى من المعالجة.
 */
const lockPath = () => path.join(config.dataDir, 'bot.lock');

/** هل العملية بهذا الرقم ما زالت حيّة؟ */
function isAlive(pid) {
  try {
    process.kill(pid, 0); // إشارة 0 تفحص الوجود ولا ترسل شيئًا
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // موجودة لكن لمستخدم آخر
  }
}

/**
 * يحجز القفل، أو يوقف التشغيل إذا كانت نسخة أخرى تعمل.
 * يرجّع دالة لتحرير القفل.
 */
export function acquireLock() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = lockPath();

  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());

    if (Number.isInteger(pid) && pid !== process.pid && isAlive(pid)) {
      console.error(
        `\n❌ نسخة أخرى من البوت تعمل بالفعل (رقم العملية ${pid}).\n` +
          '   تشغيل نسختين معًا يجعلهما تتقاتلان على جلسة واتساب بلا نهاية.\n' +
          '   أوقف الأخرى ثم أعد المحاولة:\n\n' +
          `     kill ${pid}\n`,
      );
      process.exit(1);
    }
    // قفل يتيم من عملية انتهت — نتجاوزه
  }

  fs.writeFileSync(file, String(process.pid));

  const release = () => {
    try {
      // لا نحذف قفل غيرنا
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(file);
      }
    } catch {
      /* الإغلاق لا يجب أن يفشل بسبب القفل */
    }
  };

  process.on('exit', release);
  return release;
}
