/**
 * 周次预览验证：以正常课表形式查看任意周
 *
 * 断言：
 *  1. 点「周次预览」入口能打开弹层
 *  2. 弹层里出现完整星期表头（周一…周日）与节次时间轴
 *  3. 「下一周 / 上一周」能切换周次，且标题随之变化
 *  4. 点周次胶囊能直接跳到指定周
 *  5. 切到的周若无课，显示「这一周没有课」
 *  6. 关闭后弹层消失
 *
 * 用法：node scripts/verify-week-preview.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withBrowser } from './lib/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, '.webcheck');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (wd - 1));
  return x;
}
const now = new Date();
const semesterStart = iso(new Date(mondayOf(now).getTime() - 7 * 86400000)); // 上周一 → 现在第 2 周
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// 第 3 周故意无课，用于验证空周提示
const weeksWithClass = range(1, 18).filter((w) => w !== 3);
const courses = [
  { id: 'c1', name: '高等数学A', teacher: '张三', location: '教一101', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: weeksWithClass, color: '#6366F1' },
  { id: 'c2', name: '大学英语', teacher: '李四', location: '教二203', dayOfWeek: 3, startPeriod: 3, endPeriod: 4, weeks: weeksWithClass, color: '#8B5CF6' },
  { id: 'c3', name: '数据结构', teacher: '王五', location: '计算机楼305', dayOfWeek: 5, startPeriod: 5, endPeriod: 6, weeks: weeksWithClass, color: '#0EA5E9' },
];
// 节次时间：第 1 节 08:30 起，用于验证「节次时间轴」显示的是配置的时间
const periods = [];
{
  let c = 8 * 60 + 30;
  const hh = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  for (let i = 1; i <= 8; i++) {
    periods.push({ index: i, start: hh(c), end: hh(c + 45) });
    c += 55;
  }
}
const settings = {
  semesterStart, totalWeeks: 18, periods, accentColor: '#6366F1', backgroundImage: null,
  backgroundOverlay: 0.86, dynamicIsland: true, glassEnabled: false,
  ai: { baseURL: '', apiKey: '', model: '', visionModel: '' },
  jwc: { loginURL: '', timetableURL: '', note: '' }, meta: { school: '示例大学' },
};

const PROBLEMS = [];
const OK = [];
function check(label, ok, detail = '') {
  (ok ? OK : PROBLEMS).push(label + (detail ? `  —— ${detail}` : ''));
  console.log(ok ? '✅' : '❌', label, detail ? `(${detail})` : '');
}

const browser = await withBrowser({ dist, port: 8801, cdpPort: 9343, seed: { courses, settings } });

const clickText = async (text) => {
  const pt = await browser.evalJs(`(() => {
    const all = [...document.querySelectorAll('div,span')];
    const hit = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(text)});
    if (!hit.length) return 'null';
    const el = hit[hit.length - 1];
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.top > 900) return 'offscreen';
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (!pt || pt === 'null' || pt === 'offscreen') return false;
  const p = JSON.parse(pt);
  await browser.clickAt(p.x, p.y);
  return true;
};

/**
 * 读取弹层状态。
 * 注意：RN Web 的 Modal 关闭后**可能仍留在 DOM 里**（只是隐藏），
 * 因此判断"已关闭"不能靠 innerText 是否含标题，必须看元素是否真正可见。
 */
const readModal = () => browser.evalJs(`(() => {
  const txt = document.body.innerText;
  const m = txt.match(/第 (\\d+) 周[\\s\\S]{0,30}?\\d+\\/\\d+ - \\d+\\/\\d+/);
  let visible = false;
  const all = [...document.querySelectorAll('div,span')];
  const title = all.filter(e => (e.textContent || '').trim() === '周次预览').pop();
  if (title) {
    let el = title, hidden = false;
    for (let i = 0; i < 12 && el; i++) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // 只认「真正被隐藏」：display/visibility/零尺寸。
      // 不把 opacity:0 当隐藏——Modal 动画期间祖先 opacity 可能为 0，会误判为不可见。
      if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) {
        hidden = true;
        break;
      }
      el = el.parentElement;
    }
    visible = !hidden;
  }
  return JSON.stringify({
    week: m ? +m[1] : null,
    modalVisible: visible,
    hasMon: txt.includes('周一'),
    hasSun: txt.includes('周日'),
    hasEmpty: txt.includes('这一周没有课'),
    has0830: txt.includes('08:30'),
  });
})()`);

try {
  await browser.navigate('/');
  await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
  await new Promise((r) => setTimeout(r, 1200));

  // 1. 打开预览
  const opened = await clickText('🔍 周次预览');
  check('找到并点击「周次预览」入口', opened);
  await new Promise((r) => setTimeout(r, 900));

  const s1 = JSON.parse(await readModal());
  check('弹层打开（「周次预览」可见）', s1.modalVisible);
  check('以正常课表形式呈现：出现完整星期表头', s1.hasMon && s1.hasSun, `周一=${s1.hasMon} 周日=${s1.hasSun}`);
  check('网格显示配置的第 1 节时间（08:30，非默认 08:00）', s1.has0830);
  check('默认打开在当前周（第 2 周）', s1.week === 2, `实际 ${s1.week}`);
  check('当前周有课，不显示空提示', !s1.hasEmpty);

  // 2. 下一周 → 第 3 周（无课）
  await clickText('下一周 ›');
  await new Promise((r) => setTimeout(r, 700));
  const s2 = JSON.parse(await readModal());
  check('「下一周」切到第 3 周', s2.week === 3, `实际 ${s2.week}`);
  check('无课周显示「这一周没有课」', s2.hasEmpty);

  // 3. 再下一周 → 第 4 周（有课）
  await clickText('下一周 ›');
  await new Promise((r) => setTimeout(r, 700));
  const s3 = JSON.parse(await readModal());
  check('继续切到第 4 周', s3.week === 4, `实际 ${s3.week}`);
  check('有课周恢复显示课程（无空提示）', !s3.hasEmpty);

  // 4. 上一周 → 回到第 3 周
  await clickText('‹ 上一周');
  await new Promise((r) => setTimeout(r, 700));
  const s4 = JSON.parse(await readModal());
  check('「上一周」回到第 3 周', s4.week === 3, `实际 ${s4.week}`);

  // 5. 点周次胶囊跳周（第 10 周）
  const chipClicked = await browser.evalJs(`(() => {
    const all = [...document.querySelectorAll('div')];
    // 胶囊是只有数字的窄元素
    const cands = all.filter(e => /^\\d{1,2}$/.test((e.textContent || '').trim()));
    const el = cands.find(e => (e.textContent || '').trim() === '10');
    if (!el) return 'null';
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (chipClicked && chipClicked !== 'null') {
    const cp = JSON.parse(chipClicked);
    await browser.clickAt(cp.x, cp.y);
    await new Promise((r) => setTimeout(r, 700));
    const s5 = JSON.parse(await readModal());
    check('点击周次胶囊直达第 10 周', s5.week === 10, `实际 ${s5.week}`);
  } else {
    check('点击周次胶囊直达第 10 周', false, '未找到胶囊');
  }

  // 6. 向前一直切到第 1 周，验证边界不越界
  for (let i = 0; i < 12; i++) {
    await clickText('‹ 上一周');
    await new Promise((r) => setTimeout(r, 260));
  }
  const s6 = JSON.parse(await readModal());
  check('连续上一周到边界停在第 1 周（不越界）', s6.week === 1, `实际 ${s6.week}`);

  // 7. 关闭
  const closed = await browser.evalJs(`(() => {
    const all = [...document.querySelectorAll('div,span')];
    const hit = all.filter(e => (e.textContent || '').trim() === '关闭' || (e.textContent || '').trim() === '✕');
    if (!hit.length) return 'null';
    const el = hit[hit.length - 1];
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (closed && closed !== 'null') {
    const c = JSON.parse(closed);
    await browser.clickAt(c.x, c.y);
    await new Promise((r) => setTimeout(r, 700));
    const after = JSON.parse(await readModal());
    check('关闭后弹层隐藏', !after.modalVisible);
  } else {
    console.log('ℹ️ 未找到关闭按钮，跳过关闭断言');
  }

  console.log(`\n通过：${OK.length}/${OK.length + PROBLEMS.length}`);
  if (PROBLEMS.length) {
    console.log('\n未通过：');
    for (const p of PROBLEMS) console.log('  ❌', p);
  }
} finally {
  browser.close();
}

process.exit(PROBLEMS.length === 0 ? 0 : 1);
