/**
 * 「按周次列表」布局验证
 *
 * 这个功能此前有一版，问题恰好出在布局上（滚动内容压住标题栏、当前周被挡住）。
 * 因此这里不靠肉眼看截图，而是量几何：
 *   1. 本周区块不被顶部标题栏遮挡
 *   2. 没有周区块与标题栏文字重叠
 *   3. 「回到本周」按钮不与右下角 ＋ 按钮重叠
 *   4. 周区块数量 = 学期周数；当前周带「本周」角标
 *   5. 空周显示「这一周没有课」
 *
 * 用法：
 *   npx expo export --platform web --output-dir .webcheck
 *   node scripts/verify-semester-list.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withBrowser } from './lib/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, '.webcheck');

/* ---------- 种子数据：上周一开学 → 今天第 2 周 ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (wd - 1));
  return x;
}
const now = new Date();
const semesterStart = iso(new Date(mondayOf(now).getTime() - 7 * 86400000));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// 第 3 周故意留空，用来验证「这一周没有课」
const courses = [
  { id: 'c1', name: '高等数学A', teacher: '张三', location: '教一101', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: range(1, 18).filter((w) => w !== 3), color: '#6366F1' },
  { id: 'c2', name: '大学英语', teacher: '李四', location: '教二203', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, weeks: range(1, 18).filter((w) => w !== 3), color: '#8B5CF6' },
  { id: 'c3', name: '数据结构', teacher: '王五', location: '计算机楼305', dayOfWeek: 2, startPeriod: 5, endPeriod: 6, weeks: range(1, 18).filter((w) => w !== 3), color: '#0EA5E9' },
  { id: 'c4', name: '线性代数', teacher: '赵六', location: '教三210', dayOfWeek: 3, startPeriod: 1, endPeriod: 2, weeks: range(1, 18).filter((w) => w !== 3), color: '#06B6D4' },
  // 排到第 20 周：设置总周数 18，用来验证周数取「设置值 ∪ 实际最大值」
  { id: 'c5', name: '大学物理', teacher: '孙七', location: '理科楼301', dayOfWeek: 4, startPeriod: 7, endPeriod: 8, weeks: [20], color: '#10B981' },
];
const settings = {
  semesterStart, totalWeeks: 18, accentColor: '#6366F1', backgroundImage: null,
  dynamicIsland: true, glassEnabled: false,
  ai: { baseURL: '', apiKey: '', model: '', visionModel: '' },
  jwc: { loginURL: '', timetableURL: '', note: '' }, meta: {},
};

const browser = await withBrowser({
  dist, port: 8796, cdpPort: 9338, seed: { courses, settings },
});

const PROBLEMS = [];
const OK = [];
function check(label, ok, detail = '') {
  (ok ? OK : PROBLEMS).push(label + (detail ? `  —— ${detail}` : ''));
  console.log(ok ? '✅' : '❌', label, detail ? `(${detail})` : '');
}

try {
  await browser.navigate('/');
  await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
  await new Promise((r) => setTimeout(r, 1200));

  /* ---------- 切到「全」：用真实鼠标点击 ---------- */
  const seg = await browser.evalJs(`(() => {
    const all = [...document.querySelectorAll('div,span')];
    const hit = all.filter(e => (e.textContent || '').trim() === '全');
    if (!hit.length) return null;
    const el = hit[hit.length - 1];
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (!seg) throw new Error('找不到「全」分段按钮');
  const p = JSON.parse(seg);
  await browser.clickAt(p.x, p.y);
  const rendered = await browser.waitFor(`document.body.innerText.includes('本周')`, 10000);
  check('切到「全」视图后渲染出周列表', rendered);
  await new Promise((r) => setTimeout(r, 1500)); // 等自动滚动到当前周

  /* ---------- 点周次展开该周课表网格 ---------- */
  const RECT_FN = `const rect = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };`;

  const targetWeek = 2; // 种子里今天在第 2 周
  // 只点「视口内」的块头——屏幕外的点不到（这条坑踩过）
  const headPoint = await browser.evalJs(`(() => {
    const cands = [...document.querySelectorAll('div')]
      .filter(e => /^第 ${targetWeek} 周/.test((e.textContent || '').trim()))
      .map(e => { const r = e.getBoundingClientRect(); return { r, h: r.height }; })
      .filter(x => x.h > 0 && x.h <= 40 && x.r.top >= 120 && x.r.top < 800);
    if (!cands.length) return 'null';
    cands.sort((a, b) => a.r.top - b.r.top);
    const r = cands[0].r;
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);

  if (!headPoint || headPoint === 'null') {
    check('找到视口内的第 2 周块头', false, '块头不在视口内');
  } else {
    const hp = JSON.parse(headPoint);
    await browser.clickAt(hp.x, hp.y);
    await new Promise((r) => setTimeout(r, 900));

    const grid = JSON.parse(await browser.evalJs(`(() => {
      const txt = document.body.innerText;
      const seeds = ['高等数学A', '大学英语', '数据结构', '线性代数'];
      let blocks = 0;
      for (const s of seeds) blocks += (txt.match(new RegExp(s, 'g')) || []).length;
      const scroller = [...document.querySelectorAll('div')].find(e => {
        const st = getComputedStyle(e);
        return (st.overflowY === 'auto' || st.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 5;
      });
      return JSON.stringify({
        hasMon: txt.includes('周一'), hasSun: txt.includes('周日'),
        hasCollapse: txt.includes('收起'),
        blocks,
        scrollH: scroller ? scroller.scrollHeight : null,
      });
    })()`));

    check('点击周次展开出完整星期表头（周一周日都在）', grid.hasMon && grid.hasSun,
      `周一=${grid.hasMon} 周日=${grid.hasSun}`);
    check('展开后块头出现「收起」提示', grid.hasCollapse);
    check('展开后列表变长（网格已插入）', grid.scrollH !== null && grid.scrollH > 1000,
      `scrollHeight=${grid.scrollH}`);

    // 再点一次应收起
    await browser.clickAt(hp.x, hp.y);
    await new Promise((r) => setTimeout(r, 700));
    const stillOpen = await browser.evalJs(`(() => document.body.innerText.includes('收起'))()`);
    check('再次点击可收起', !stillOpen);

    // 恢复状态，继续后续量测
    await browser.waitFor(`document.body.innerText.includes('本周')`, 5000);
    await new Promise((r) => setTimeout(r, 800));
  }

  /* ---------- 几何量测 ---------- */
  const geo = JSON.parse(await browser.evalJs(`(() => {
    ${'' /* 内联辅助：RN Web 文本节点可能带子节点，用"文本相等"筛选 */}
    const findText = (t) => {
      const all = [...document.querySelectorAll('div,span')];
      const hits = all.filter(e => (e.textContent || '').trim() === t);
      return hits.length ? hits[hits.length - 1] : null;
    };
    const rect = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };

    // 标题栏：标题 + 副标题 + 分段控件所在的那一层
    const title = findText('大学课表');
    const subtitle = (() => {
      const all = [...document.querySelectorAll('div,span')];
      const hits = all.filter(e => /^第 \\d+ 周 · \\d+ 门课$/.test((e.textContent || '').trim()));
      return hits.length ? hits[hits.length - 1] : null;
    })();
    const segBox = findText('全');
    const titleBox = title ? rect(title) : null;
    const subtitleBox = subtitle ? rect(subtitle) : null;
    // 标题栏底边取「副标题」和「分段控件」的较大者
    let headerBottom = null;
    if (subtitleBox) headerBottom = subtitleBox.bottom;
    if (segBox) {
      const sb = rect(segBox);
      headerBottom = headerBottom === null ? sb.bottom : Math.max(headerBottom, sb.bottom);
    }

    // 周区块头：用「第 N 周 + 日期区间」这个组合文本定位。
    // 坑1：RN Web 会在嵌套层级重复出现同一文本（坐标相同），不能直接计数。
    // 坑2：外层容器也可能匹配到这个组合文本，其高度覆盖整块（甚至整个列表），
    //      因此只取「块头尺寸」的候选（高度 <= 40），否则会把整块当块头。
    const candidates = [...document.querySelectorAll('div')]
      .filter(e => /^第 \\d+ 周\\s*\\d+\\/\\d+\\s*-\\s*\\d+\\/\\d+/.test((e.textContent || '').trim()))
      .map(e => {
        const t = (e.textContent || '').trim();
        const no = +((t.match(/^第 (\\d+) 周/) || [0, 0])[1]);
        return { no, box: rect(e) };
      })
      .filter((w) => w.no > 0 && w.box.h <= 40);

    // 按周次去重（同一周多个嵌套层级 → 取 top 最小者，它们在屏幕上位置相同）
    const seen = new Map();
    for (const w of candidates) {
      const cur = seen.get(w.no);
      if (!cur || w.box.top < cur.box.top) seen.set(w.no, w);
    }
    const allWeekRows = [...seen.entries()]
      .map(([no, v]) => ({ no, top: v.box.top, bottom: v.box.bottom }))
      .sort((a, b) => a.no - b.no);
    // 只统计「在可视区内出现过」的周次数，用于断言周数是否正确
    const distinctWeeks = allWeekRows.length;

    // 本周角标
    const badge = findText('本周');

    // 回到本周按钮 & ＋ 按钮
    const jump = findText('回到本周');
    const fab = findText('＋');

    // 滚动容器
    const scrollers = [...document.querySelectorAll('div')].filter(e => {
      const s = getComputedStyle(e);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 5;
    }).map(e => ({ scrollTop: +e.scrollTop.toFixed(1), clientH: e.clientHeight, scrollH: e.scrollHeight, padTop: getComputedStyle(e).paddingTop }));

    return JSON.stringify({
      titleBox, subtitleBox, headerBottom,
      weekNoEls: allWeekRows,
      weekCount: distinctWeeks,
      maxWeekNo: allWeekRows.length ? Math.max(...allWeekRows.map((w) => w.no)) : 0,
      badgeBox: badge ? rect(badge) : null,
      jumpBox: jump ? rect(jump) : null,
      fabBox: fab ? rect(fab) : null,
      scrollers,
    });
  })()`));

  /**
   * 取当前 DOM 里出现过的周次。
   *
   * 坑：不能只匹配 '第 N 周'（RN Web 嵌套重复），也不能要求「第N周+日期」相邻
   * （本周块头中间夹着「本周」角标，且角标与周次是兄弟节点、不共享文本）。
   * 稳妥做法：找出所有形如「第 N 周…」的容器，按周次分组，
   * 取每组里**最外层**的那个（scrollHeight 最大）作为该周的区块，从而每周只算一次。
   */
  const accumulateWeeks = async () => {
    const js = await browser.evalJs(`(() => {
      const cands = [...document.querySelectorAll('div')]
        .filter(e => /^第 \\d+ 周/.test((e.textContent || '').trim()))
        .map(e => {
          const t = (e.textContent || '').trim();
          const no = +(((t.match(/^第 (\\d+) 周/) || [0, 0])[1]));
          return { no, scrollH: e.scrollHeight, cls: String(e.className || '') };
        })
        .filter(x => x.no > 0);
      return JSON.stringify(cands);
    })()`);
    const cands = JSON.parse(js || '[]');
    const best = new Map();
    for (const c of cands) {
      const cur = best.get(c.no);
      if (!cur || c.scrollH > cur.scrollH) best.set(c.no, c);
    }
    return [...best.keys()];
  };

  const seenWeeks = new Set(await accumulateWeeks());

  // 滚到底再滚回，尽量让每个周区块都进过 DOM
  const scrollInfo = JSON.parse(await browser.evalJs(`(() => {
    const el = [...document.querySelectorAll('div')].find(e => {
      const s = getComputedStyle(e);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 5;
    });
    if (!el) return 'null';
    return JSON.stringify({ max: el.scrollHeight - el.clientHeight });
  })()`));

  if (scrollInfo) {
    // 步长要小于最小的周区块高度，否则会在两个采样点之间漏掉某一周
    for (let y = 0; y <= scrollInfo.max; y += 150) {
      await browser.evalJs(`(() => {
        const el = [...document.querySelectorAll('div')].find(e => {
          const s = getComputedStyle(e);
          return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 5;
        });
        if (el) el.scrollTop = ${y};
        return 'ok';
      })()`);
      await new Promise((r) => setTimeout(r, 180));
      for (const n of await accumulateWeeks()) seenWeeks.add(n);
    }
    // 再从头扫一遍，确保起始位置也被采到
    for (let y = scrollInfo.max; y >= 0; y -= 150) {
      await browser.evalJs(`(() => {
        const el = [...document.querySelectorAll('div')].find(e => {
          const s = getComputedStyle(e);
          return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 5;
        });
        if (el) el.scrollTop = ${y};
        return 'ok';
      })()`);
      await new Promise((r) => setTimeout(r, 180));
      for (const n of await accumulateWeeks()) seenWeeks.add(n);
    }
  }

  console.log('\n--- 量测 ---');
  console.log('标题栏底边      :', geo.headerBottom);
  console.log('滚动遍历到的周次:', [...seenWeeks].sort((a, b) => a - b).join(', '));
  console.log('本周角标        :', geo.badgeBox ? `top=${geo.badgeBox.top}` : '(无)');
  console.log('滚动容器        :', JSON.stringify(geo.scrollers));
  console.log('屏内可见周区块  :', JSON.stringify(geo.weekNoEls.filter((w) => w.bottom > (geo.headerBottom ?? 0) && w.top < 850).slice(0, 4)));
  console.log('回到本周按钮    :', geo.jumpBox ? JSON.stringify(geo.jumpBox) : '(无)');
  console.log('＋ 按钮         :', geo.fabBox ? JSON.stringify(geo.fabBox) : '(无)');

  /* ---------- 断言 ---------- */
  console.log('\n--- 断言 ---');

  // 1. 周数：设置 18 周，但有课程排到第 20 周 → 应遍历到第 20 周且连续
  const weeks = [...seenWeeks].sort((a, b) => a - b);
  const maxWeek = weeks.length ? Math.max(...weeks) : 0;
  const minWeek = weeks.length ? Math.min(...weeks) : 0;
  const missing = [];
  for (let w = 1; w <= 20; w++) if (!seenWeeks.has(w)) missing.push(w);
  check('周次覆盖到第 20 周（设置 18 ∪ 课程实际 20）', maxWeek === 20, `最大周次 ${maxWeek}`);
  check('周次从第 1 周连续到第 20 周，无缺号', minWeek === 1 && missing.length === 0,
    missing.length ? `缺 ${missing.join(',')}` : '');

  // 2. 本周角标存在
  check('当前周带「本周」角标', !!geo.badgeBox);

  // 3. 关键：本周区块不被标题栏遮挡
  if (geo.badgeBox && geo.headerBottom !== null) {
    check('「本周」角标在标题栏下方（不被遮挡）', geo.badgeBox.top >= geo.headerBottom - 1,
      `角标 top=${geo.badgeBox.top}, 标题栏底边=${geo.headerBottom}`);
  } else {
    check('「本周」角标在标题栏下方（不被遮挡）', false, '缺数据');
  }

  // 4. 屏内周区块头不与标题栏重叠（排除已滚出视口上方的元素，那是正常的）
  const overlapping = geo.weekNoEls.filter(
    (w) => w.top >= 0 && w.top < (geo.headerBottom ?? 0) - 1 && w.bottom > 0,
  );
  check('屏内周区块头不与标题栏文字重叠', overlapping.length === 0,
    overlapping.length ? `重叠：${overlapping.map((w) => `第${w.no}周@${w.top}`).join(', ')}` : '');

  // 5. 「回到本周」不与 ＋ 重叠
  if (geo.jumpBox && geo.fabBox) {
    const overlapX = !(geo.jumpBox.right < geo.fabBox.left || geo.jumpBox.left > geo.fabBox.right);
    const overlapY = !(geo.jumpBox.bottom < geo.fabBox.top || geo.jumpBox.top > geo.fabBox.bottom);
    check('「回到本周」按钮不与 ＋ 按钮重叠', !(overlapX && overlapY),
      `jump=${JSON.stringify(geo.jumpBox)} fab=${JSON.stringify(geo.fabBox)}`);
  } else {
    check('「回到本周」按钮不与 ＋ 按钮重叠', false, `jump=${!!geo.jumpBox} fab=${!!geo.fabBox}`);
  }

  // 6. 有滚动能力（说明确实能看完整学期）
  check('列表可滚动（scrollHeight > clientHeight）',
    geo.scrollers.length > 0 && geo.scrollers[0].scrollH > geo.scrollers[0].clientH + 100,
    geo.scrollers.length ? `scrollH=${geo.scrollers[0].scrollH} clientH=${geo.scrollers[0].clientH}` : '无滚动容器');

  // 7. 空周提示（第 3 周没课）
  const emptyShown = await browser.evalJs(`(() => document.body.innerText.includes('这一周没有课'))()`);
  check('空周显示「这一周没有课」', !!emptyShown);

  console.log(`\n通过：${OK.length}/${OK.length + PROBLEMS.length}`);
  if (PROBLEMS.length) {
    console.log('\n未通过：');
    for (const p of PROBLEMS) console.log('  ❌', p);
  }
} finally {
  browser.close();
}

process.exit(PROBLEMS.length === 0 ? 0 : 1);
