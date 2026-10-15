/**
 * v1.7.1 三项改动浏览器验证
 *
 * 覆盖：
 *  A. **周六/周日不再串列**（BUG 修复）：七天各自的课程只出现在自己那一列
 *  B. 内嵌网格不再溢出（几何修复）：周次预览里的七列全部落在可视区内
 *  C. 一格多天 → 多条课程（走真实的「粘贴导入」链路验证）
 *  D. 设置页**分类抽屉**：分组、摘要、展开/收起、以及「关掉抽屉样式」后全部平铺
 *
 * 用法：node scripts/verify-v171.mjs（需先 npx expo export --platform web --output-dir .webcheck）
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
const semesterStart = iso(new Date(mondayOf(now).getTime() - 7 * 86400000)); // 上周一 → 现在第 2 周

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
/**
 * 每天一门同名同节次的课 —— 这样"某天的课跑到别的列"会立刻暴露。
 * 周六/周日各再加一门（同一天同一时段）用于顺带验证分列仍然正常。
 */
const courses = [
  ...DAY_CN.map((_, i) => ({
    id: 'd' + (i + 1),
    name: DAY_CN[i] + '课',
    teacher: '张' + (i + 1),
    location: '教' + (i + 1) + '101',
    dayOfWeek: i + 1,
    startPeriod: 1,
    endPeriod: 2,
    weeks: WEEKS,
    color: colors[i],
  })),
  { id: 'sat2', name: '周六二课', teacher: '李六', location: '风雨操场', dayOfWeek: 6, startPeriod: 1, endPeriod: 2, weeks: WEEKS, color: '#84CC16' },
  { id: 'sun2', name: '周日二课', teacher: '李日', location: '体育馆', dayOfWeek: 7, startPeriod: 1, endPeriod: 2, weeks: WEEKS, color: '#EC4899' },
];

const settings = {
  semesterStart,
  totalWeeks: 20,
  periods,
  accentColor: '#6366F1',
  backgroundImage: null,
  backgroundOverlay: 0.86,
  dynamicIsland: false,
  glassEnabled: false,
  ai: { baseURL: 'https://api.deepseek.com', apiKey: 'sk-test-not-real', model: 'deepseek-chat', visionModel: '' },
  jwc: { loginURL: '', timetableURL: '', note: '' },
  meta: { school: '示例大学', semester: '2025-2026 第一学期' },
  settingsDrawer: true,
};

const PROBLEMS = [];
const OK = [];
function check(label, ok, detail = '') {
  (ok ? OK : PROBLEMS).push(label + (detail ? `  —— ${detail}` : ''));
  console.log(ok ? '✅' : '❌', label, detail ? `(${detail})` : '');
}

const browser = await withBrowser({ dist, port: 8810, cdpPort: 9352, seed: { courses, settings } });
const h = makeHelpers(browser);
const { evalJs } = browser;

/** 读七天表头列区间 + 所有课程块所在列的归属 */
const readGrid = () =>
  evalJs(`(() => {
    const visible = ${VISIBLE};
    const dayCn = ${JSON.stringify(DAY_CN)};
    const heads = [];
    for (const d of dayCn) {
      const el = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === d && visible(e)).pop();
      heads.push(el ? (() => { const r = el.getBoundingClientRect(); return { d, left: +r.left.toFixed(1), right: +r.right.toFixed(1) }; })() : { d, missing: true });
    }
    const names = ${JSON.stringify(courses.map((c) => c.name))};
    const blocks = [];
    for (const n of names) {
      const el = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === n && visible(e)).pop();
      if (!el) { blocks.push({ n, missing: true }); continue; }
      let blk = el;
      for (let i = 0; i < 5 && blk; i++) {
        const bg = getComputedStyle(blk).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
        blk = blk.parentElement;
      }
      const r = blk.getBoundingClientRect();
      blocks.push({ n, left: +r.left.toFixed(1), right: +r.right.toFixed(1), cx: +((r.left + r.right) / 2).toFixed(1), w: +r.width.toFixed(1) });
    }
    return JSON.stringify({ heads, blocks, winW: window.innerWidth });
  })()`);

try {
  await browser.navigate('/');
  await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
  await sleep(1300);

  /* ---------------- A. 周六/周日不串列 ---------------- */
  const toWeek = await h.clickText('周');
  check('A0 能切到「周」视图', toWeek);
  await sleep(900);

  const g = JSON.parse(await readGrid());
  const headOf = Object.fromEntries(g.heads.map((x) => [x.d, x]));
  const blocks = g.blocks.filter((b) => !b.missing);
  check('A1 七天表头齐全', g.heads.length === 7 && g.heads.every((x) => !x.missing), JSON.stringify(g.heads.map((x) => x.d)));
  check('A2 九天课程块（7 天各 1 门 + 周六周日各多 1 门）全部渲染', blocks.length === 9, `命中 ${blocks.length}/9`);

  /** 课程块中心点是否落在对应天的列区间内 */
  const inColumn = (name, dayIdx) => {
    const b = blocks.find((x) => x.n === name);
    const col = headOf[DAY_CN[dayIdx]];
    if (!b || !col) return { ok: false, why: '缺元素' };
    // 表头文字是居中的，列区间 = 表头区间向两侧各扩 colW/2
    const colW = b.w;
    const left = col.left - colW / 2;
    const right = col.right + colW / 2;
    const ok = b.cx > left - 1 && b.cx < right + 1;
    return { ok, why: `块中心 ${b.cx} vs 列 [${left.toFixed(1)}, ${right.toFixed(1)}]` };
  };

  let allIn = true;
  const detail = [];
  DAY_CN.forEach((d, i) => {
    const r = inColumn(d + '课', i);
    if (!r.ok) allIn = false;
    detail.push(`${d}:${r.ok ? '✓' : '✗'}`);
  });
  check('A3 七天课程各自落在自己那一列（核心断言）', allIn, detail.join(' '));

  const sat = inColumn('周六课', 5);
  const sat2 = inColumn('周六二课', 5);
  const sun = inColumn('周日课', 6);
  const sun2 = inColumn('周日二课', 6);
  check('A4 周六的两门课都在周六列（分列并排）', sat.ok && sat2.ok, `${sat.why} / ${sat2.why}`);
  check('A5 周日的两门课都在周日列（**不再被挤进周六列**）', sun.ok && sun2.ok, `${sun.why} / ${sun2.why}`);

  const satBlocks = blocks.filter((b) => b.n.startsWith('周六'));
  const sunBlocks = blocks.filter((b) => b.n.startsWith('周日'));
  const noCross = satBlocks.every((s) => sunBlocks.every((u) => s.right <= u.left + 1 || u.right <= s.left + 1));
  check('A6 周六块与周日块的横向区间互不重叠', noCross, `周六 x=[${satBlocks.map((b) => b.left + '~' + b.right).join(',')}] 周日 x=[${sunBlocks.map((b) => b.left + '~' + b.right).join(',')}]`);

  const sunRight = Math.max(...sunBlocks.map((b) => b.right));
  check('A7 周日列完整落在屏幕内（右边界未超出窗口）', sunRight <= g.winW + 0.5, `周日最右 ${sunRight} / 窗口 ${g.winW}`);

  /* ---------------- B. 内嵌网格（周次预览）不再溢出 ---------------- */
  await h.clickText('🔍 周次预览');
  await sleep(1100);
  const gg = JSON.parse(await readGrid());
  const sunBlocks2 = gg.blocks.filter((b) => b.n.startsWith('周日') && !b.missing);
  const satBlocks2 = gg.blocks.filter((b) => b.n.startsWith('周六') && !b.missing);
  check(
    'B1 周次预览里七列也全部落在可视区内（不再被挤出屏幕）',
    sunBlocks2.length > 0 && Math.max(...sunBlocks2.map((b) => b.right)) <= gg.winW + 0.5,
    `周日最右 ${sunBlocks2.length ? Math.max(...sunBlocks2.map((b) => b.right)) : '缺失'} / 窗口 ${gg.winW}`,
  );
  const headsB = Object.fromEntries(gg.heads.map((x) => [x.d, x]));
  const noCrossB =
    satBlocks2.length > 0 &&
    sunBlocks2.length > 0 &&
    satBlocks2.every((s) => sunBlocks2.every((u) => s.right <= u.left + 1 || u.right <= s.left + 1));
  check('B2 周次预览里周六/周日两块也不重叠', noCrossB, `周六右 ${satBlocks2[0]?.right} 周日左 ${sunBlocks2[0]?.left}`);

  // 关闭周次预览：SheetModal 的关闭按钮是「✕」（不是「关闭」）
  const closedPreview = await h.clickText('✕');
  await sleep(700);
  // 用**只在弹层里出现**的文案判断是否真的关掉了（"按周查看…"是课表页入口按钮上的字，不能用）
  const previewGone = await evalJs(`!document.body.innerText.includes('‹ 上一周')`);
  check('B3 能关闭周次预览（否则后续点击会被弹层挡住）', closedPreview && previewGone, `点击=${closedPreview} 已关闭=${previewGone}`);

  /* ---------------- C. 一格多天 → 多条课程（粘贴导入链路） ---------------- */
  await h.clickText('设置', 'r.top > 640');
  await sleep(1000);
  const settingsOpen = await evalJs(`document.body.innerText.includes('分类折叠（抽屉）')`);
  check('C0a 设置页已打开（分类抽屉可见）', settingsOpen);
  const openData = await h.clickText('数据管理');
  check('C0 能展开「数据管理」抽屉', openData);
  await sleep(500);
  await h.clickText('导入课表 (JSON)');
  await sleep(700);
  const json = JSON.stringify({
    contract: 'univ-timetable/v1',
    meta: { school: '示例大学', semesterStart, totalWeeks: 20 },
    courses: [{ name: '周末实验', teacher: '王老师', location: '实验楼A', dayOfWeek: '周六、周日', startPeriod: 5, endPeriod: 6, weeks: WEEKS }],
  });
  const typed = await evalJs(`(() => {
    const el = [...document.querySelectorAll('textarea')].filter(e => (e.placeholder || '').includes('粘贴')).pop();
    if (!el) return 'no-el';
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify('```json\\n' + json + '\\n```')});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  check('C1 能粘贴课表文件全文到导入框', typed === 'ok', `结果 ${typed}`);
  await sleep(300);
  await h.clickText('解析并导入');
  await sleep(1000);
  const stored = await h.readStore('univtimetable/courses/v1');
  const weekend = (stored || []).filter((c) => c.name === '周末实验');
  const days = weekend.map((c) => c.dayOfWeek).sort((a, b) => a - b);
  check(
    'C2 「周六、周日」不再只落周六：导入后生成周六 + 周日两条',
    weekend.length === 2 && JSON.stringify(days) === '[6,7]',
    `条数 ${weekend.length} 星期 ${JSON.stringify(days)}`,
  );

  /* ---------------- D. 设置分类抽屉 ---------------- */
  const drawerState = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const has = (t) => [...document.querySelectorAll('div,span')].some(e => (e.textContent || '').trim() === t && visible(e));
      const titles = ['学期与作息', '外观与主题', 'AI 服务', '课表来源（教务系统）', '分享与接收课表', '数据管理'];
      const body = document.body.innerText;
      return JSON.stringify({
        modeToggle: has('分类折叠（抽屉）'),
        titles: titles.map(t => (has(t) ? 1 : 0)),
        chevrons: (body.match(/展开 ▸/g) || []).length,
        collapses: (body.match(/收起 ▾/g) || []).length,
        semesterBody: has('节次时间表'),
        appearanceBody: has('强调色'),
        aiBody: has('API Key'),
        dataBody: has('导出课表 (JSON)'),
        summaryHasWeeks: /20 周/.test(body),
      });
    })()`),
  );
  check('D1 设置页出现「分类折叠（抽屉）」开关', drawerState.modeToggle);
  check('D2 六个分类标题齐全', drawerState.titles.every((x) => x === 1), JSON.stringify(drawerState.titles));
  check(
    'D3 默认只展开第一个分类（其余收起：强调色/API Key 不可见）',
    drawerState.semesterBody && !drawerState.appearanceBody && !drawerState.aiBody,
    `学期内容=${drawerState.semesterBody} 外观内容=${drawerState.appearanceBody} AI内容=${drawerState.aiBody}`,
  );
  check('D4 每个分类都带状态摘要（如「20 周」）', drawerState.summaryHasWeeks);
  check(
    'D5 六个分类都有折叠提示（展开 ▸ / 收起 ▾ 合计 6 个，两种状态都出现过）',
    drawerState.chevrons + drawerState.collapses === 6 && drawerState.chevrons >= 1 && drawerState.collapses >= 1,
    `展开=${drawerState.chevrons} 收起=${drawerState.collapses}`,
  );

  const openAppearance = await h.clickText('外观与主题');
  await sleep(600);
  const afterOpen = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const has = (t) => [...document.querySelectorAll('div,span')].some(e => (e.textContent || '').trim() === t && visible(e));
      return JSON.stringify({ appearanceBody: has('强调色'), glass: has('毛玻璃效果') });
    })()`),
  );
  check('D6 点标题能展开该分类（强调色等出现）', openAppearance && afterOpen.appearanceBody);

  // 关掉抽屉样式 → 全部平铺
  const toggleOff = await evalJs(`(() => {
    const visible = ${VISIBLE};
    const label = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === '分类折叠（抽屉）' && visible(e)).pop();
    if (!label) return 'no-label';
    // 先把开关滚进视口：否则 rect 可能是负值，点不到（本轮实测踩到）
    label.scrollIntoView({ block: 'center' });
    let row = label;
    for (let i = 0; i < 4 && row; i++) {
      const sw = row.querySelector && row.querySelector('input[type=checkbox]');
      if (sw) {
        const r = sw.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      }
      row = row.parentElement;
    }
    return 'no-switch';
  })()`);
  if (toggleOff && toggleOff.startsWith('{')) {
    const p = JSON.parse(toggleOff);
    await browser.clickAt(p.x, p.y);
  }
  await sleep(800);
  const flat = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const has = (t) => [...document.querySelectorAll('div,span')].some(e => (e.textContent || '').trim() === t && visible(e));
      const body = document.body.innerText;
      return JSON.stringify({
        appearanceBody: has('强调色'),
        aiBody: has('API Key'),
        dataBody: has('导出课表 (JSON)'),
        chevrons: (body.match(/展开 ▸/g) || []).length,
        stored: JSON.parse(localStorage.getItem('univtimetable/settings/v1') || '{}').settingsDrawer,
      });
    })()`),
  );
  check('D7 关掉抽屉样式后，所有分类内容同时可见（平铺）', flat.appearanceBody && flat.aiBody && flat.dataBody, JSON.stringify({ 外观: flat.appearanceBody, AI: flat.aiBody, 数据: flat.dataBody }));
  check('D8 平铺模式下不再显示「展开 ▸」折叠提示', flat.chevrons === 0, `展开标记数 ${flat.chevrons}`);
  check('D9 该开关已写入设置（settingsDrawer=false）', flat.stored === false, `实际 ${flat.stored}`);

  console.log(`\n通过：${OK.length}/${OK.length + PROBLEMS.length}`);
  if (PROBLEMS.length) {
    console.log('\n未通过：');
    for (const p of PROBLEMS) console.log('  ❌', p);
  }
} finally {
  browser.close();
}

process.exit(PROBLEMS.length === 0 ? 0 : 1);
