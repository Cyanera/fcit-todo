import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** يشغّل عملية تحجز القفل وتبقى حيّة، ويرجّعها مع دالة إيقاف. */
function holder(dataDir) {
  const code = `
    process.env.DATA_DIR = ${JSON.stringify(dataDir)};
    const { acquireLock } = await import(${JSON.stringify(path.join(root, 'src/lock.js'))});
    acquireLock();
    console.log('held');
    await new Promise((r) => setTimeout(r, 10000));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir },
  });
  return child;
}

test('نسخة ثانية تُرفض ما دامت الأولى حيّة', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const child = holder(dataDir);

  // ننتظر حجز القفل فعليًا
  await new Promise((resolve) => {
    child.stdout.on('data', (b) => String(b).includes('held') && resolve());
    setTimeout(resolve, 3000);
  });

  const second = spawnSync(
    process.execPath,
    ['--input-type=module', '-e',
     `const { acquireLock } = await import(${JSON.stringify(path.join(root, 'src/lock.js'))}); acquireLock();`],
    { cwd: root, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' },
  );

  child.kill();

  assert.equal(second.status, 1, 'النسخة الثانية تخرج بخطأ');
  assert.match(second.stderr, /نسخة أخرى من البوت تعمل/);
});

test('قفل يتيم من عملية منتهية لا يمنع التشغيل', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  // رقم عملية شبه مستحيل أن يكون حيًّا
  fs.writeFileSync(path.join(dataDir, 'bot.lock'), '999999');

  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e',
     `const { acquireLock } = await import(${JSON.stringify(path.join(root, 'src/lock.js'))}); acquireLock(); console.log('ok');`],
    { cwd: root, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, 'القفل اليتيم يُتجاوز');
  assert.match(result.stdout, /ok/);
});
