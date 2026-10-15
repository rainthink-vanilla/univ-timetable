/**
 * 灵动岛布局验证（BUG-001 / BUG-002 回归）
 *
 * 做法：Web 构建 + 无头 Chrome，注入课表数据后测量灵动岛的三项关键几何：
 *   1. 岛高 >= 内容高（不裁切）
 *   2. 内容下边缘与岛下边缘之间是否有留白（padding 生效）
 *   3. 展开前后岛高是否变化（BUG-002：插值不能退化成常量）
 *
 * 三种场景：有课（两行）、无课（空态两行）、展开态
 *
 * 用法：
 *   npx expo export --platform web --output-dir .webcheck
 *   node scripts/verify-island.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, '.webcheck');
// Chrome 的 profile 写到系统临时目录，别污染 .webcheck（否则会生成几百个文件）
const profileDir = join(tmpdir(), 'dsh-island-chrome-profile');
const PORT = 8795;
const CDP_PORT = 9337;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!existsSync(join(dist, 'index.html'))) {
  console.error('缺少 .webcheck，请先： npx expo export --platform web --output-dir .webcheck');
  process.exit(1);
}

/* ---------- 静态服务器 ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const file = join(dist, url === '/' ? 'index.html' : url);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('nope');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* ---------- 数据 ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = x.getDay() === 0 ? 7 : x.getDay(); x.setDate(x.getDate() - (wd - 1)); return x; }
const now = new Date();
const semesterStart = iso(new Date(mondayOf(now).getTime() - 7 * 86400000)); // 上周一 → 现在第 2 周
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// 今天（周几）排一门课，让收起态出现第二行「课程名」
const todayDow = now.getDay() === 0 ? 7 : now.getDay();
const courses = [
  { id: 'c1', name: '高等数学A', teacher: '张三', location: '教一101', dayOfWeek: todayDow, startPeriod: 1, endPeriod: 2, weeks: range(1, 16), color: '#6366F1' },
  { id: 'c2', name: '大学英语（读写译）', teacher: '李四', location: '教二203', dayOfWeek: todayDow, startPeriod: 5, endPeriod: 6, weeks: range(1, 16), color: '#8B5CF6' },
];
const settings = {
  semesterStart, totalWeeks: 18, accentColor: '#6366F1', backgroundImage: null,
  dynamicIsland: true, glassEnabled: false,
  ai: { baseURL: '', apiKey: '', model: '', visionModel: '' },
  jwc: { loginURL: '', timetableURL: '', note: '' }, meta: {},
};

/* ---------- Chrome ---------- */
try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`, '--window-size=393,850', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function waitCdp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome 调试端口未就绪');
}
await waitCdp();
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 850, deviceScaleFactor: 2, mobile: true });

const seed = (c) => `try{localStorage.setItem('univtimetable/courses/v1',${JSON.stringify(JSON.stringify(c))});localStorage.setItem('univtimetable/settings/v1',${JSON.stringify(JSON.stringify(settings))});}catch(e){}`;

mkdirSync(dist, { recursive: true });
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const out = join(dist, `${name}.png`);
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  return out;
}

/**
 * 找到灵动岛容器（黑底且含“第 N 周”文本），返回其 rect。
 * 注意：RN for Android 默认 includeFontPadding 在 Web 上不存在，所以 Web 上量到的
 * 高度会比 Android 小；本脚本验证的是「容器高度由实测驱动、不写死」这一结构是否成立，
 * 以及在 Web 的字体度量下是否裁切。
 */
const MEASURE = `(() => {
  const all = [...document.querySelectorAll('div')];
  const islands = all.filter(e => {
    const s = getComputedStyle(e).backgroundColor;
    return s === 'rgb(0, 0, 0)' && /第\\s*\\d+\\s*周/.test(e.textContent || '');
  });
  if (!islands.length) return JSON.stringify({ found: false });
  const island = islands[islands.length - 1];
  const ir = island.getBoundingClientRect();
  // 岛内所有叶子文本节点
  const texts = [...island.querySelectorAll('*')].filter(e => {
    const t = (e.textContent || '').trim();
    return t.length > 0 && ![...e.children].some(c => (c.textContent || '').trim().length > 0);
  });
  let top = Infinity, bottom = -Infinity;
  for (const t of texts) {
    const r = t.getBoundingClientRect();
    top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
  }
  /** 岛内所有可见行（用 top 去重，近似“行数”） */
  const rowTops = [...new Set(texts.map(t => Math.round(t.getBoundingClientRect().top)))];
  return JSON.stringify({
    found: true,
    islandH: +ir.height.toFixed(1),
    contentTop: +top.toFixed(1), contentBottom: +bottom.toFixed(1),
    contentH: +(bottom - top).toFixed(1),
    padTop: +(top - ir.top).toFixed(1),
    padBottom: +(ir.bottom - bottom).toFixed(1),
    overflow: getComputedStyle(island).overflow,
    clipped: (top < ir.top - 0.5) || (bottom > ir.bottom + 0.5),
    rowCount: rowTops.length,
    lines: texts.map(t => (t.textContent || '').trim().slice(0, 24)),
  });
})()`;

/** 取灵动岛的屏幕坐标（用于派发真实输入事件） */
const ISLAND_CENTER = `(() => {
  const all = [...document.querySelectorAll('div')];
  const islands = all.filter(e => getComputedStyle(e).backgroundColor === 'rgb(0, 0, 0)' && /第\\s*\\d+\\s*周/.test(e.textContent || ''));
  if (!islands.length) return 'null';
  const r = islands[islands.length - 1].getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`;

/**
 * 用 CDP 派发真实鼠标事件。
 * 不能用 element.dispatchEvent 合成事件——RN Web 的 Pressable 走 Responder 系统，
 * 只认真实的 pointer/touch 输入。
 */
async function clickAt(x, y) {
  const base = { x, y, button: 'left', clickCount: 1, buttons: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await new Promise((r) => setTimeout(r, 40));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
}

/** 等岛高稳定（首帧是内容自然高，onLayout 写回后才是最终值） */
async function waitStableHeight(prev = -1, tries = 25) {
  let last = prev;
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const m = JSON.parse(await evalJs(MEASURE));
    if (m.found && m.islandH === last) return m;
    if (m.found) last = m.islandH;
  }
  return JSON.parse(await evalJs(MEASURE));
}

const results = [];

/* ---------- 场景 1：有课（收起，两行） ---------- */
await send('Page.addScriptToEvaluateOnNewDocument', { source: seed(courses) });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));
let m = await waitStableHeight();
results.push(['收起态·有课', m]);
await shot('island-collapsed-with-course');

/* ---------- 场景 2：展开 ---------- */
const centerRaw = await evalJs(ISLAND_CENTER);
console.log('灵动岛中心坐标:', centerRaw);
const center = JSON.parse(centerRaw);
if (center) {
  await clickAt(center.x, center.y);
  console.log('已派发真实鼠标点击');
}
await new Promise((r) => setTimeout(r, 900));
let m2 = await waitStableHeight(m.islandH);
results.push(['展开态·有课', m2]);
await shot('island-expanded');

/* ---------- 场景 3：空态（当天无课） ----------
   注意：必须用 addScriptToEvaluateOnNewDocument 注入，且它会叠加执行；
   若只在当前文档里改 localStorage，App 卸载保存时会把旧数据写回去。 */
await send('Page.addScriptToEvaluateOnNewDocument', { source: seed([]) });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));
let m3 = await waitStableHeight();
results.push(['收起态·无课', m3]);
await shot('island-collapsed-empty');

/* ---------- 报告 ---------- */
console.log('\n================ 灵动岛布局验证 ================');
for (const [name, r] of results) {
  console.log(`\n【${name}】`);
  if (!r.found) { console.log('  ❌ 未找到灵动岛'); continue; }
  console.log(`  岛高        : ${r.islandH}`);
  console.log(`  内容高      : ${r.contentH}`);
  console.log(`  上留白      : ${r.padTop}`);
  console.log(`  下留白      : ${r.padBottom}   ${r.padBottom >= 6 ? '✅' : '❌ 太小'}`);
  console.log(`  是否裁切    : ${r.clipped ? '❌ 是' : '✅ 否'}  (overflow=${r.overflow})`);
  console.log(`  文本行数    : ${r.rowCount}`);
  console.log(`  文本行      : ${JSON.stringify(r.lines)}`);
}

const collapsed = results[0][1];
const expanded = results[1][1];
const empty = results[2][1];

const checks = [
  ['BUG-001 收起态不裁切（有课）', collapsed.found && !collapsed.clipped],
  ['BUG-001 收起态下留白 >= 6pt（有课）', collapsed.found && collapsed.padBottom >= 6],
  ['BUG-001 收起态不裁切（无课）', empty.found && !empty.clipped],
  ['BUG-001 收起态下留白 >= 6pt（无课）', empty.found && empty.padBottom >= 6],
  ['BUG-002 展开态不裁切', expanded.found && !expanded.clipped],
  ['BUG-002 展开高度 > 收起高度（插值未退化）', expanded.found && collapsed.found && expanded.islandH > collapsed.islandH + 10],
];
console.log('\n================ 断言 ================');
let pass = 0;
for (const [label, ok] of checks) {
  if (ok) pass++;
  console.log(ok ? '✅' : '❌', label);
}
console.log(`\n通过：${pass}/${checks.length}`);

ws.close();
chrome.kill();
server.close();
try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
process.exit(pass === checks.length ? 0 : 1);
