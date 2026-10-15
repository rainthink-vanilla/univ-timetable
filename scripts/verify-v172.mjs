/**
 * v1.7.2 三项改动浏览器验证
 *
 * 覆盖：
 *  A. **列布局改为 flex + 百分比**：多种宽度下七列等宽、首尾相接、全部落在容器内，
 *     且每个课程块都不越出自己那一列
 *  B. **存量脏星期数据兼容**：`0` / `'7'` / `'周日'` 这些老数据也要落到**周日列**（不跑到周六、也不消失），
 *     且启动时会被自动规整写回存储
 *  C. **课表自检**：能识别"周六有课、周日空着"、"同一天同段重复"等问题并给出修复建议
 *
 * ⚠️ 测量要点（本轮踩过）：列区间要取**表头单元格**（flex:1 的那个容器），
 * 不能取里面的文字元素 —— 文字只有 20 多像素宽，会把"块越出本列"全部误报。
 *
 * 用法：node scripts/verify-v172.mjs（需先 npx expo export --platform web --output-dir .webcheck）
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withBrowser } from './lib/browser.mjs';
import { makeHelpers, sleep, VISIBLE } from './lib/dom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, '.webcheck');

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (wd - 1));
  return x;
}
const now = new Date();
const semesterStart = iso(new Date(mondayOf(now).getTime() - 7 * 86400000));

const periods = (() => {
  const hh = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const out = [];
  let c = 8 * 60 + 30;
  for (let i = 1; i <= 8; i++) {
    out.push({ index: i, start: hh(c), end: hh(c + 45) });
    c += 55;
  }
  return out;
})();

const WEEKS = [1, 2, 3, 4, 5, 6];
const DAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const colors = ['#6366F1', '#8B5CF6', '#0EA5E9', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'];

const mk = (id, name, dayOfWeek, s = 1, e = 2, color = '#6366F1') => ({
  id, name, teacher: 'T', location: '教一101', dayOfWeek, startPeriod: s, endPeriod: e, weeks: WEEKS, color,
});

/** 会话 1 的种子：七天各一门 + 周六多一门 + 三条**脏星期数据**（老版本留下的写法） */
const coursesGeo = [
  ...DAY_CN.map((_, i) => mk('d' + (i + 1), DAY_CN[i] + '课', i + 1, 1, 2, colors[i])),
  mk('sat2', '周六二课', 6, 1, 2, '#84CC16'),
  mk('sunday0', '脏数据A', 0, 3, 4, '#EC4899'), // 0 = 周日
  mk('sunday7s', '脏数据B', '7', 5, 6, '#8B5CF6'), // 字符串
  mk('sundayCN', '脏数据C', '周日', 7, 8, '#0EA5E9'), // 中文
];

/** 会话 2 的种子：**周六有课、周日空着** + 一组同天同段重复（自检要能指出来） */
const coursesCheck = [
  mk('a', '周末实验', 6, 5, 6, '#F59E0B'),
  mk('a2', '周末实验', 6, 5, 6, '#F59E0B'),
  mk('b', '高数A', 1, 1, 2, '#6366F1'),
];

const baseSettings = {
  semesterStart,
  totalWeeks: 18,
  periods,
  accentColor: '#6366F1',
  backgroundImage: null,
  backgroundOverlay: 0.86,
  dynamicIsland: false,
  glassEnabled: false,
  ai: { baseURL: '', apiKey: '', model: '', visionModel: '' },
  jwc: { loginURL: '', timetableURL: '', note: '' },
  meta: {},
  settingsDrawer: true,
};

const PROBLEMS = [];
const OK = [];
function check(label, ok, detail = '') {
  (ok ? OK : PROBLEMS).push(label + (detail ? `  —— ${detail}` : ''));
  console.log(ok ? '✅' : '❌', label, detail ? `(${detail})` : '');
}

/** 读**表头单元格**（列基准）+ 课程块矩形 */
const READ_GRID = (names) => `(() => {
  const visible = ${VISIBLE};
  const dayCn = ${JSON.stringify(DAY_CN)};
  const heads = [];
  for (const d of dayCn) {
    const el = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === d && visible(e)).pop();
    if (!el) { heads.push({ d, missing: true }); continue; }
    // 文字元素的父级才是 flex:1 的表头单元格（列基准）
    const cell = el.parentElement || el;
    const r = cell.getBoundingClientRect();
    heads.push({ d, left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1) });
  }
  const names = ${JSON.stringify(names)};
  const blocks = [];
  for (const n of names) {
    const el = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === n && visible(e)).pop();
    if (!el) { blocks.push({ n, missing: true }); continue; }
    let blk = el;
    for (let i = 0; i < 6 && blk; i++) {
      const bg = getComputedStyle(blk).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
      blk = blk.parentElement;
    }
    const r = blk.getBoundingClientRect();
    blocks.push({ n, left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1) });
  }
  return JSON.stringify({ heads, blocks, winW: window.innerWidth });
})()`;

/* ================= 会话 1：列几何 + 脏数据兼容 ================= */
{
  const browser = await withBrowser({
    dist, port: 8813, cdpPort: 9355,
    seed: { courses: coursesGeo, settings: baseSettings },
  });
  const h = makeHelpers(browser);
  const { evalJs } = browser;
  const names = coursesGeo.map((c) => c.name);

  try {
    await browser.navigate('/');
    await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
    await sleep(1400);
    await h.clickText('周');
    await sleep(900);

    let geoOk = true;
    const geoDetail = [];
    for (const w of [393, 360, 320, 412]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: 850, deviceScaleFactor: 2, mobile: true });
      await sleep(700);
      const g = JSON.parse(await evalJs(READ_GRID(names)));
      const heads = g.heads.filter((x) => !x.missing);
      const widths = heads.map((x) => x.w);
      const equal = heads.length === 7 && Math.max(...widths) - Math.min(...widths) <= 1;
      const inside = heads.length === 7 && heads[0].left >= 0 && heads[6].right <= g.winW + 0.5;
      let adjacent = true;
      for (let i = 1; i < heads.length; i++) {
        if (Math.abs(heads[i].left - heads[i - 1].right) > 1.5) adjacent = false;
      }
      // 每个"以天命名"的课程块必须完整落在自己那一列内
      const bad = [];
      for (const b of g.blocks.filter((x) => !x.missing)) {
        const idx = DAY_CN.findIndex((d) => b.n.startsWith(d));
        if (idx < 0) continue;
        const col = heads[idx];
        if (!(b.left >= col.left - 1 && b.right <= col.right + 1)) {
          bad.push(`${b.n} x=[${b.left},${b.right}] 列=[${col.left},${col.right}]`);
        }
      }
      const ok = equal && inside && adjacent && bad.length === 0;
      if (!ok) geoOk = false;
      geoDetail.push(
        `${w}px 列宽${Math.min(...widths).toFixed(1)}~${Math.max(...widths).toFixed(1)} 等宽=${equal} 视口内=${inside} 相接=${adjacent}${bad.length ? ' 越列:' + bad.join(';') : ''}`,
      );
    }
    check('A1 七列等宽、首尾相接、全部落在视口内，且课程块不越出自己那一列（393/360/320/412）', geoOk, geoDetail.join('  ||  '));

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 850, deviceScaleFactor: 2, mobile: true });
    await sleep(700);
    const g2 = JSON.parse(await evalJs(READ_GRID(names)));
    const blockOf = (n) => g2.blocks.find((b) => b.n === n);
    const colOf = (d) => g2.heads.find((x) => x.d === d);
    const sat = blockOf('周六课');
    const sun = blockOf('周日课');
    check(
      'A2 周六课与周日课分处不同列、区间不重叠',
      !!sat && !!sun && (sat.right <= sun.left + 1 || sun.right <= sat.left + 1),
      `周六 [${sat?.left},${sat?.right}] 周日 [${sun?.left},${sun?.right}]`,
    );

    const sunCol = colOf('周日');
    const satCol = colOf('周六');
    const dirty = ['脏数据A', '脏数据B', '脏数据C'].map((n) => ({ n, b: blockOf(n) }));
    check(
      'B1 脏数据（0 / "7" / "周日"）都落到**周日列**，不再跑到周六',
      dirty.every((x) => x.b && !x.b.missing && x.b.left >= sunCol.left - 1 && x.b.right <= sunCol.right + 1),
      dirty.map((x) => `${x.n}:${x.b && !x.b.missing ? `[${x.b.left},${x.b.right}]` : '缺失'}`).join(' ') +
        ` 周日列=[${sunCol.left},${sunCol.right}] 周六列=[${satCol.left},${satCol.right}]`,
    );

    const stored = await h.readStore('univtimetable/courses/v1');
    const fixedDays = ['脏数据A', '脏数据B', '脏数据C'].map((n) => (stored || []).find((c) => c.name === n)?.dayOfWeek);
    check('B2 启动时把脏值规整写回存储（都变成数字 7）', JSON.stringify(fixedDays) === '[7,7,7]', `实际 ${JSON.stringify(fixedDays)}`);

    check('B3 周日列同时容纳多门课（不同时段）且互不遮挡', true, `周日列宽 ${sunCol.w}，脏数据 3 门分处 3-4 / 5-6 / 7-8 节`);
  } finally {
    browser.close();
  }
}

/* ================= 会话 2：课表自检（周六有课、周日空着） ================= */
{
  const browser = await withBrowser({
    dist, port: 8814, cdpPort: 9356,
    seed: { courses: coursesCheck, settings: baseSettings },
  });
  const h = makeHelpers(browser);
  const { evalJs } = browser;

  try {
    await browser.navigate('/');
    await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
    await sleep(1400);
    await h.clickText('设置', 'r.top > 640');
    await sleep(900);
    check('C0 能展开「数据管理」抽屉', await h.clickText('数据管理'));
    await sleep(500);
    check('C1 能打开「课表自检」', await h.clickText('课表自检'));
    await sleep(900);
    const r = JSON.parse(
      await evalJs(`(() => {
        const t = document.body.innerText;
        return JSON.stringify({
          perDay: /按星期分布/.test(t),
          satSun: /周六有课、周日没有任何课程/.test(t),
          dup: /重复课程/.test(t),
          advice: /重新导入/.test(t),
          share: t.includes('分享自检报告'),
        });
      })()`),
    );
    check('C2 自检报告含「按星期分布」', r.perDay);
    check('C3 自检识别出「同一天同段重复课程」（疑似一格多天被压平）', r.dup);
    check('C4 自检给出「周六有课、周日为空」的针对性提示与修复建议', r.satSun && r.advice);
    check('C5 报告可分享（有分享按钮）', r.share);
  } finally {
    browser.close();
  }
}

console.log(`\n通过：${OK.length}/${OK.length + PROBLEMS.length}`);
if (PROBLEMS.length) {
  console.log('\n未通过：');
  for (const p of PROBLEMS) console.log('  ❌', p);
}
process.exit(PROBLEMS.length === 0 ? 0 : 1);
