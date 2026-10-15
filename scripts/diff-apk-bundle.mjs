/**
 * 对比两个 APK 的 Hermes bundle，判断某次改动是否真的打进包。
 *
 * 用途：构建成功 ≠ 改动在包里。本脚本按标识逐项比对，并明确标注
 * 哪些标识是「本次改动新增」的有效证据、哪些是通用字符串（不可作为证据）。
 *
 * 用法：node scripts/diff-apk-bundle.mjs <旧.apk> <新.apk>
 */
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** 从 APK 里取出并解压 assets/index.android.bundle */
function bundleOf(apkPath) {
  const buf = readFileSync(apkPath);
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8);
      const csize = buf.readUInt32LE(off + 18);
      const nlen = buf.readUInt16LE(off + 26);
      const elen = buf.readUInt16LE(off + 28);
      const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
      const dstart = off + 30 + nlen + elen;
      if (name === 'assets/index.android.bundle') {
        const raw = buf.subarray(dstart, dstart + csize);
        return method === 0 ? raw : inflateRawSync(raw);
      }
      off = dstart + csize;
    } else off++;
  }
  return null;
}

/**
 * Hermes 把字符串以 UTF-16LE 存放；ASCII 标识两种编码都可能命中，
 * 所以 utf8 与 utf16le 都要试。
 */
const hasIn = (buf, s) =>
  buf.includes(Buffer.from(s, 'utf16le')) || buf.includes(Buffer.from(s, 'utf8'));

const oldApk = process.argv[2];
const newApk = process.argv[3];
if (!oldApk || !newApk) {
  console.error('用法：node scripts/diff-apk-bundle.mjs <旧.apk> <新.apk>');
  process.exit(2);
}
for (const p of [oldApk, newApk]) {
  if (!existsSync(p)) {
    console.error('找不到文件：', p);
    process.exit(2);
  }
}

const oldBuf = bundleOf(oldApk);
const newBuf = bundleOf(newApk);
if (!oldBuf || !newBuf) {
  console.error('未能从 APK 中取出 Hermes bundle');
  process.exit(2);
}

console.log('旧包：', oldApk, `(${(oldBuf.length / 1048576).toFixed(2)} MB bundle)`);
console.log('新包：', newApk, `(${(newBuf.length / 1048576).toFixed(2)} MB bundle)`);
console.log('');

/**
 * 标识清单。`evidence: true` 表示该标识由本次改动引入，
 * 只在新包出现即可作为「改动已进包」的有效证据。
 */
const MARKERS = [
  { label: '周次列表：视图标签「全」', s: '全' },
  { label: '周次列表：回到本周', s: '回到本周' },
  { label: '周次列表：空周提示', s: '这一周没有课' },
  { label: '周次列表：本周角标', s: '本周' },
  { label: '文件导入入口', s: '文件导入' },
  { label: '选择文件按钮', s: '选择文件' },
  { label: '导入策略-更新合并', s: '更新合并' },
  { label: '灵动岛修复：includeFontPadding', s: 'includeFontPadding' },
  { label: '契约标识', s: 'univ-timetable/v1' },
  // v1.5.0 新增（仅新包应有的证据）
  { label: '周次预览：入口文案', s: '🔍 周次预览' },
  { label: '周次预览：按周查看提示', s: '按周查看 · 可前后切换' },
  { label: '主题：小节标题', s: '自定义主题' },
  { label: '主题：规格说明', s: '图片规格' },
  { label: '主题：规格格式文案', s: 'JPG / PNG / WebP' },
  { label: '主题：尺寸不足提示', s: '放大后会模糊' },
  { label: '主题：启动器图标说明', s: '手机桌面上的应用图标由安装包决定' },
  { label: '主题：背景遮罩', s: '背景遮罩（越深越清晰）' },
  { label: '分享：小节标题', s: '分享与接收课表' },
  { label: '分享：接收按钮', s: '接收同学的课表文件' },
  { label: '分享：套用对方主题', s: '导入课表 + 应用对方主题' },
  // v1.6.0 新增（仅新包应有的证据）
  // 注意：标识必须取自**不会被 ${...} 插值打断**的静态片段（踩坑 16/新增）
  { label: '裁剪：弹层标题', s: '裁剪背景图' },
  { label: '裁剪：图标标题', s: '裁剪图标' },
  { label: '裁剪：操作提示', s: '拖动图片调整位置' },
  { label: '裁剪：确认按钮', s: '使用这张' },
  { label: '裁剪：比例选项', s: '全屏（推荐）' },
  { label: '裁剪：未裁剪提示', s: '当前未裁剪' },
  { label: '裁剪：非破坏性说明', s: '可随时重新裁剪' },
  { label: '裁剪：过小告警', s: '放大后可能模糊。可点「重置」恢复全图。' },
  { label: '主题：重新裁剪入口', s: '重新裁剪' },
  { label: '强调色：立即生效说明', s: '选中后立即生效' },
  { label: '星期多选：表单标签', s: '星期（可多选' },
  { label: '星期多选：新增说明', s: '选几天就生成几条课程' },
  { label: '星期多选：按钮文案片段', s: ' 天各一条）' },
  // 边栏双时间是**数据驱动**渲染（每节的起止时间来自用户配置），没有新增文案，
  // 因此只能拿样式键名当线索；脚本会如实标注它是否构成有效证据。
  { label: '边栏双时间：结束时间样式键', s: 'timeTextEnd' },
  // v1.7.0 新增（仅新包应有的证据）
  { label: '三个标签图标：槽位状态文案', s: '自定义主题' },
  { label: '三个标签图标：上传按钮片段', s: '上传图标图片' },
  { label: '三个标签图标：恢复默认', s: '」默认图标' },
  { label: '三个标签图标：emoji 提示', s: '选一个 emoji' },
  { label: '尺寸放宽：硬下限说明', s: '就可用：偏小的图不会被拒绝' },
  { label: '尺寸放宽：升级提示语', s: '清晰度按裁剪后的实际尺寸评价' },
  { label: '目标尺寸提示', s: '该比例建议 ≥' },
  { label: '裁剪分级：偏小', s: '放大后可能模糊）' },
  { label: '裁剪：捏合提示', s: '双指捏合缩放（可同时拖动）' },
  { label: '地点换行：窄块字号', s: 'blockLocNarrow' },
  { label: '分列排布：列宽换算', s: 'laneBox' },
  // v1.7.1 新增（仅新包应有的证据）
  { label: '设置抽屉：开关文案', s: '分类折叠（抽屉）' },
  { label: '设置抽屉：开关说明', s: '按功能分组，点标题展开 / 收起；关掉后全部分类平铺展开' },
  { label: '设置分类：学期与作息', s: '学期与作息' },
  { label: '设置分类：外观与主题', s: '外观与主题' },
  { label: '设置分类：课表来源', s: '课表来源（教务系统）' },
  { label: '设置分类：数据管理', s: '数据管理' },
  { label: '设置抽屉：收起提示', s: '收起 ▾' },
  { label: '设置抽屉：展开提示', s: '展开 ▸' },
  { label: '一格多天解析：normalizeDays', s: 'normalizeDays' },
  // v1.7.2 新增（仅新包应有的证据）
  { label: '课表自检：按钮', s: '课表自检' },
  { label: '课表自检：分享按钮', s: '分享自检报告' },
  { label: '课表自检：报告标题', s: '大学课表 · 课表自检报告' },
  { label: '课表自检：按星期分布', s: '按星期分布' },
  { label: '课表自检：周六周日专项提示', s: '周六有课、周日没有任何课程' },
  { label: '课表自检：重复课程提示', s: '同名同地点' },
  { label: '星期兼容：coerceDayOfWeek', s: 'coerceDayOfWeek' },
  { label: '启动自动规整：normalizeStoredCourses', s: 'normalizeStoredCourses' },
  { label: '列布局：百分比换算 lanePercent', s: 'lanePercent' },
];

console.log('标识'.padEnd(34), '旧包', ' 新包', ' 说明');
console.log('-'.repeat(72));
const newOnly = [];
for (const m of MARKERS) {
  const o = hasIn(oldBuf, m.s);
  const n = hasIn(newBuf, m.s);
  const note = o && n ? '两版都有（通用字符串，非本次证据）' : n && !o ? '★ 仅新包有 → 改动已进包' : !n ? '两版都没有' : '';
  if (n && !o) newOnly.push(m.label);
  console.log(m.label.padEnd(34), (o ? ' ✓  ' : ' ✗  '), (n ? '  ✓  ' : '  ✗  '), note);
}

console.log('');
if (newOnly.length) {
  console.log(`结论：${newOnly.length} 个标识仅新包存在 → 本次改动确实已打进包：`);
  for (const l of newOnly) console.log('  ★', l);
} else {
  console.log('结论：没有发现仅新包存在的标识 —— 无法证明本次改动已进包，请检查构建产物是否为最新代码。');
}
