/**
 * APK 校验脚本
 *
 * 构建成功 ≠ 功能在里面。本脚本对 APK 二进制做四件事：
 *   1. 校验 ZIP 结构与 APK 签名块（v2/v3）
 *   2. 解压 assets/index.android.bundle（Hermes）并检查新功能字符串
 *   3. 解压 classes*.dex 并检查原生模块类名
 *   4. 读取内嵌 assets/app.config 核对包名/版本
 *
 * 注意：Hermes 把字符串以 UTF-16LE 存放，用 utf8 搜中文会全部漏掉。
 *
 * 运行：node scripts/verify-apk.mjs [apk路径]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function pickApk() {
  const arg = process.argv[2];
  if (arg) return arg;
  const apks = readdirSync(root).filter((f) => f.endsWith('.apk'));
  if (!apks.length) {
    console.error('未找到 .apk 文件');
    process.exit(1);
  }
  return join(root, apks.sort().reverse()[0]);
}

const apkPath = pickApk();
const buf = readFileSync(apkPath);

/* ---------- 1. 结构与签名 ---------- */
console.log('=== APK ===');
console.log('文件：', apkPath);
console.log('大小：', (buf.length / 1048576).toFixed(1), 'MB');
console.log('ZIP magic：', buf.subarray(0, 2).toString('ascii'));

const sigMagic = Buffer.from('APK Sig Block 42');
const sigAt = buf.indexOf(sigMagic);
console.log('APK Sig Block 42（v2/v3 签名）：', sigAt >= 0 ? `✅ @${sigAt}` : '❌ 未找到');

/* ---------- 解压中央目录里的指定条目 ---------- */
function readEntry(targetName) {
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8);
      const csize = buf.readUInt32LE(off + 18);
      const nlen = buf.readUInt16LE(off + 26);
      const elen = buf.readUInt16LE(off + 28);
      const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
      const dstart = off + 30 + nlen + elen;
      if (name === targetName) {
        const raw = buf.subarray(dstart, dstart + csize);
        return method === 0 ? raw : inflateRawSync(raw);
      }
      off = dstart + csize;
    } else off++;
  }
  return null;
}

/* ---------- 2. Hermes bundle ---------- */
const bundle = readEntry('assets/index.android.bundle');
if (!bundle) {
  console.error('❌ 未找到 assets/index.android.bundle');
  process.exit(1);
}
console.log('\n=== Hermes bundle ===');
console.log('解压后：', (bundle.length / 1048576).toFixed(2), 'MB');
const hasStr = (s) => bundle.includes(Buffer.from(s, 'utf16le')) || bundle.includes(Buffer.from(s, 'utf8'));

const features = [
  ['文件导入入口', '文件导入'],
  ['选择文件按钮', '选择文件'],
  ['导入策略-更新合并', '更新合并'],
  ['导入策略-整体替换', '整体替换'],
  ['安全提醒-去改密码', '去改密码'],
  ['导出 .md', '导出为 .md 文件'],
  ['契约标识', 'univ-timetable/v1'],
  ['契约生成器', 'buildTimetableMarkdown'],
  ['元信息兜底解析', 'metaFromText'],
  ['文件选择器调用', 'pickFileAsync'],
];
let pass = 0;
for (const [label, needle] of features) {
  const ok = hasStr(needle);
  if (ok) pass++;
  console.log(ok ? '✅' : '❌', label);
}

/* ---------- 3. 原生模块 ---------- */
console.log('\n=== 原生模块（dex） ===');
let dexAll = '';
for (const name of ['classes.dex', 'classes2.dex', 'classes3.dex', 'classes4.dex', 'classes5.dex']) {
  const d = readEntry(name);
  if (d) dexAll += d.toString('latin1');
}
console.log('dex 总长：', (dexAll.length / 1048576).toFixed(1), 'MB');
for (const cls of ['FilePickerContract', 'FileSystemModule', 'FileSystemFile']) {
  const ok = dexAll.includes(cls);
  if (ok) pass++;
  console.log(ok ? '✅' : '❌', cls);
}

/* ---------- 4. app.config ---------- */
const cfg = readEntry('assets/app.config');
if (cfg) {
  const j = JSON.parse(cfg.toString('utf8'));
  console.log('\n=== 内嵌配置 ===');
  console.log('name：', j.name, '| version：', j.version, '| package：', j.android?.package, '| SDK：', j.sdkVersion);
}

console.log(`\n校验通过：${pass}/${features.length + 3}`);
process.exit(pass === features.length + 3 ? 0 : 1);
