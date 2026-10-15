/**
 * v1.7.0 四项改动浏览器验证
 *
 * 覆盖：
 *  A. 课程块**不再重合**（BUG 修复）：同日重叠课程分列排布、列间有间隔、独立课程仍占满整列
 *  B. **地点自动换行、尽量显示全**：地点多行显示、不被裁掉、不再限一行
 *  C. **图片尺寸接受范围扩增**：低于旧下限（600px）的图不再被拒绝，进入裁剪并给出分级提示与目标尺寸
 *  D. **双指缩放**：真实触摸事件（两根手指）驱动裁剪器缩放
 *  E. **底部三个标签都能换图标**（v1.7.0 新增需求）：三个槽独立设置图片 / emoji
 *
 * 用法：node scripts/verify-v170.mjs（需先 npx expo export --platform web --output-dir .webcheck）
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { withBrowser } from './lib/browser.mjs';
import { makeHelpers, sleep, VISIBLE } from './lib/dom.mjs';
import { makePng } from './lib/png.mjs';

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
  for (let i = 1; i <= 10; i++) {
    out.push({ index: i, start: hh(c), end: hh(c + 45) });
    c += 55;
  }
  return out;
})();

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8];
/** 长地点：挂在**整列宽**的课上，用于验证"能全部显示出来" */
const LONG_LOC = '教三401（新校区图书馆东侧）';
/**
 * 周一同时放 5 门课，覆盖三种相对关系：
 *  重合（a/b 都是 1-2 节）→ 必须并排
 *  部分重叠（c 4-5 与 d 5-6）→ 必须并排
 *  独立（e 9-10，整列宽）→ 占满整列，并且它的长地点必须能完整显示
 */
const courses = [
  { id: 'a', name: '高数A', teacher: '张三', location: '教一101（东配楼三层最里侧）', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: WEEKS, color: '#6366F1' },
  { id: 'b', name: '英语B', teacher: '李四', location: '教二203', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: WEEKS, color: '#8B5CF6' },
  { id: 'c', name: '体育C', teacher: '王五', location: '田径场', dayOfWeek: 1, startPeriod: 4, endPeriod: 5, weeks: WEEKS, color: '#0EA5E9' },
  { id: 'd', name: '实验D', teacher: '赵六', location: '实验楼B座305', dayOfWeek: 1, startPeriod: 5, endPeriod: 6, weeks: WEEKS, color: '#10B981' },
  { id: 'e', name: '选修E', teacher: '钱七', location: LONG_LOC, dayOfWeek: 1, startPeriod: 9, endPeriod: 10, weeks: WEEKS, color: '#F59E0B' },
  { id: 'f', name: '周三课', teacher: '孙八', location: '教四202', dayOfWeek: 3, startPeriod: 1, endPeriod: 2, weeks: WEEKS, color: '#EC4899' },
];

const TAB_ICON_URL = `data:image/png;base64,${makePng(24, 24).toString('base64')}`;
const settings = {
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
  meta: { school: '示例大学' },
  // E 组：三个标签各自的图标（第一个用图片、另两个用 emoji）
  themeTabIcons: {
    timetable: { uri: TAB_ICON_URL, emoji: null, crop: null },
    import: { uri: null, emoji: '🐳', crop: null },
    settings: { uri: null, emoji: '🍀', crop: null },
  },
  // v1.7.1 起设置页默认是「分类抽屉」；本脚本聚焦 v1.7.0 的裁剪/图标，用平铺模式免得先展开抽屉
  settingsDrawer: false,
};

const PROBLEMS = [];
const OK = [];
function check(label, ok, detail = '') {
  (ok ? OK : PROBLEMS).push(label + (detail ? `  —— ${detail}` : ''));
  console.log(ok ? '✅' : '❌', label, detail ? `(${detail})` : '');
}

const browser = await withBrowser({ dist, port: 8805, cdpPort: 9347, seed: { courses, settings } });
const h = makeHelpers(browser);
const { evalJs } = browser;

/** 读周一所有课程块的矩形（含名字、地点文本与行数） */
const readBlocks = () =>
  evalJs(`(() => {
    const visible = ${VISIBLE};
    const names = ${JSON.stringify(courses.filter((c) => c.dayOfWeek === 1).map((c) => c.name))};
    const out = [];
    for (const name of names) {
      const el = [...document.querySelectorAll('div,span')]
        .filter(e => (e.textContent || '').trim() === name && visible(e))
        .pop();
      if (!el) { out.push({ name, missing: true }); continue; }
      // 向上找到"课程块"：带背景色的那一层
      let block = el;
      for (let i = 0; i < 5 && block; i++) {
        const bg = getComputedStyle(block).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
        block = block.parentElement;
      }
      const br = block.getBoundingClientRect();
      // 地点元素：块内文本里包含该课程 location 的那个
      const course = ${JSON.stringify(courses.filter((c) => c.dayOfWeek === 1).map((c) => ({ name: c.name, location: c.location })))}
        .find(c => c.name === name);
      const locEl = [...block.querySelectorAll('div,span')]
        .filter(e => !e.children.length && (e.textContent || '').trim() === course.location)
        .pop() || null;
      let locLines = 0, locOverflow = null, locClamp = null, locClientH = null, locScrollH = null;
      if (locEl) {
        const range = document.createRange();
        range.selectNodeContents(locEl);
        locLines = range.getClientRects().length;
        locOverflow = +(locEl.scrollHeight - locEl.clientHeight).toFixed(1);
        locClientH = +locEl.clientHeight.toFixed(1);
        locScrollH = +locEl.scrollHeight.toFixed(1);
        const cs = getComputedStyle(locEl);
        locClamp = cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp') || 'none';
      }
      out.push({
        name,
        left: +br.left.toFixed(1), right: +br.right.toFixed(1),
        top: +br.top.toFixed(1), bottom: +br.bottom.toFixed(1),
        w: +br.width.toFixed(1), h: +br.height.toFixed(1),
        locText: locEl ? (locEl.textContent || '').trim() : null,
        locLines, locOverflow, locClamp, locClientH, locScrollH,
        blockOverflow: +(block.scrollHeight - block.clientHeight).toFixed(1),
      });
    }
    // 周一列宽：取**日列容器**的宽度
    // v1.7.2 起块结构是「列 > 定位壳(Pressable) > 可见卡片」，
    // 因此要比卡片再上两层才是日列（只上一层会量到并排后的半列宽）
    const first = [...document.querySelectorAll('div,span')]
      .filter(e => (e.textContent || '').trim() === names[0] && visible(e)).pop();
    let colW = null;
    if (first) {
      let block = first;
      for (let i = 0; i < 5 && block; i++) {
        const bg = getComputedStyle(block).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
        block = block.parentElement;
      }
      const wrap = block.parentElement;
      const colEl = wrap && wrap.parentElement ? wrap.parentElement : wrap;
      colW = colEl ? +colEl.getBoundingClientRect().width.toFixed(1) : null;
    }
    return JSON.stringify({ blocks: out, colW });
  })()`);

try {
  await browser.navigate('/');
  await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
  await sleep(1200);

  /* ---------------- E. 底部三个标签图标（先测量，便于后面确认未被改动） ---------------- */
  const tabIcons0 = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const bar = [...document.querySelectorAll('div')].filter(d => {
        const r = d.getBoundingClientRect();
        return r.top > 640 && r.height > 40 && r.height < 90 && r.width > 380;
      }).pop();
      const label = (t) => {
        const els = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === t && visible(e));
        return els.length ? (els[els.length - 1].getBoundingClientRect().top > 640 ? 'in-bar' : 'elsewhere') : 'missing';
      };
      const imgInBar = [...document.querySelectorAll('img')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.top > 640 && r.width > 8 && r.width < 40;
      }).length;
      return JSON.stringify({ hasBar: !!bar, imgInBar, labels: ['课表','导入','设置'].map(label) });
    })()`),
  );
  check('E1 底部标签栏存在且三个标签就位', tabIcons0.hasBar && tabIcons0.labels.every((x) => x === 'in-bar'), JSON.stringify(tabIcons0));

  const tabIconRead = JSON.parse(
    await evalJs(`(() => {
      const barTop = 640;
      const inBar = (e) => e.getBoundingClientRect().top > barTop;
      const imgs = [...document.querySelectorAll('img')].filter(e => inBar(e) && e.src.startsWith('data:image/png'));
      const texts = [...document.querySelectorAll('div,span')].filter(e => !e.children.length && inBar(e)).map(e => (e.textContent || '').trim());
      return JSON.stringify({ imgCount: imgs.length, whale: texts.includes('🐳'), clover: texts.includes('🍀') });
    })()`),
  );
  check('E2 第一个标签用的是自定义图片（其余不受影响）', tabIconRead.imgCount >= 1, `图片数 ${tabIconRead.imgCount}`);
  check('E3 第二个标签显示自定义 emoji 🐳', tabIconRead.whale);
  check('E4 第三个标签显示自定义 emoji 🍀（旧版只能换第一个）', tabIconRead.clover);

  /* ---------------- E 续：给第三个标签换 emoji ---------------- */
  await h.clickText('设置', 'r.top > 640');
  await sleep(800);
  // 槽位定位：'设置' 文本在页面上有三处（页面标题 / 槽位标签 / 底部标签），
  // 用「父元素含 默认|自定义」唯一锁定槽位（曾因按坐标范围过滤而点错，见留档）
  const slotPt = await evalJs(`(() => {
    const visible = ${VISIBLE};
    const els = [...document.querySelectorAll('div,span')]
      .filter(e => (e.textContent || '').trim() === '设置' && visible(e))
      .filter(e => {
        const p = e.parentElement;
        if (!p) return false;
        const t = (p.textContent || '').trim();
        return /(默认|自定义)$/.test(t) && t.length <= 8;
      });
    if (!els.length) return 'null';
    const el = els[els.length - 1];
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (slotPt && slotPt !== 'null') {
    const p = JSON.parse(slotPt);
    await browser.clickAt(p.x, p.y);
  }
  check('E5 能选中「设置」图标槽', !!slotPt && slotPt !== 'null');
  await sleep(500);
  let btnText = await evalJs(`(() => {
    const t = document.body.innerText;
    return t.includes('为「设置」上传图标图片') ? 'ok' : 'missing';
  })()`);
  check('E6 下方操作区已切换到「设置」标签', btnText === 'ok');

  const clickEmoji = async (emoji) => {
    const p = await evalJs(`(() => {
      const visible = ${VISIBLE};
      const els = [...document.querySelectorAll('div,span')].filter(e => (e.textContent || '').trim() === ${JSON.stringify(emoji)} && visible(e));
      if (!els.length) return 'null';
      const el = els[els.length - 1];
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`);
    if (!p || p === 'null') return false;
    const q = JSON.parse(p);
    await browser.clickAt(q.x, q.y);
    return true;
  };

  const picked = await clickEmoji('🎈');
  await sleep(800);
  const after = await h.readStore('univtimetable/settings/v1');
  check('E7 第三个标签的 emoji 已写入设置（三个标签可独立设置）', after?.themeTabIcons?.settings?.emoji === '🎈', JSON.stringify(after?.themeTabIcons ?? null));
  check(
    'E8 改第三个标签不影响第一个标签（仍是自定义图片）',
    typeof after?.themeTabIcons?.timetable?.uri === 'string' && after.themeTabIcons.timetable.uri.length > 20,
    `第一个标签 uri 长度 ${String(after?.themeTabIcons?.timetable?.uri ?? '').length}`,
  );

  const finalBar = JSON.parse(
    await evalJs(`(() => {
      const inBar = (e) => e.getBoundingClientRect().top > 640;
      const texts = [...document.querySelectorAll('div,span')].filter(e => !e.children.length && inBar(e)).map(e => (e.textContent || '').trim());
      const imgs = [...document.querySelectorAll('img')].filter(e => inBar(e) && e.src.startsWith('data:image/png')).length;
      return JSON.stringify({ balloon: texts.includes('🎈'), whale: texts.includes('🐳'), imgs });
    })()`),
  );
  check('E9 标签栏立即反映新图标（🎈 出现、🐳 与图片仍在）', finalBar.balloon && finalBar.whale && finalBar.imgs >= 1, JSON.stringify(finalBar));
  check('E10 三个标签的 emoji 互不干扰（导入仍为 🐳）', finalBar.whale && picked);

  /* ---------------- A/B. 周视图：分列 + 地点换行 ---------------- */
  await h.clickText('课表', 'r.top > 640');
  await sleep(600);
  const toWeek = await h.clickText('周');
  check('A0 能切到「周」视图', toWeek);
  await sleep(900);

  const day1 = JSON.parse(await readBlocks());
  const blocks = day1.blocks.filter((b) => !b.missing);
  const byName = Object.fromEntries(blocks.map((b) => [b.name, b]));
  check('A1 周一 5 门课全部渲染出课程块', blocks.length === 5, `命中 ${blocks.length}/5`);

  /** 两个矩形是否重叠（留 0.5px 容差） */
  const rectsOverlap = (p, q) =>
    p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5;

  const pairs = [
    ['高数A', '英语B'], // 节次完全相同
    ['体育C', '实验D'], // 部分重叠（第 5 节）
  ];
  let overlapOk = true;
  const overlapDetail = [];
  for (const [x, y] of pairs) {
    const p = byName[x];
    const q = byName[y];
    const bad = p && q && rectsOverlap(p, q);
    if (bad) overlapOk = false;
    overlapDetail.push(`${x}/${y}=${bad ? '重叠' : '已分开'}`);
  }
  check('A2 时间重叠的课程块不再互相覆盖（BUG 修复）', overlapOk, overlapDetail.join(' '));

  const pairWidthOk = pairs.every(([x, y]) => {
    const p = byName[x];
    const q = byName[y];
    return p && q && p.w < 0.75 * (day1.colW ?? 0) && q.w < 0.75 * (day1.colW ?? 0) && p.w > 0.25 * (day1.colW ?? 0);
  });
  check('A3 重叠课程各占约半列宽（并排显示，都看得见）', pairWidthOk, `列宽 ${day1.colW}，高数A 宽 ${byName['高数A']?.w}，英语B 宽 ${byName['英语B']?.w}`);

  const solo = byName['选修E'];
  check('A4 不与任何课重叠的课程仍占满整列（不被无谓压窄）', !!solo && solo.w > 0.85 * (day1.colW ?? 0), `选修E 宽 ${solo?.w} / 列宽 ${day1.colW}`);

  const vGap = byName['体育C'] && byName['高数A'] ? byName['体育C'].bottom !== undefined && byName['体育C'].top - Math.max(byName['高数A'].bottom, byName['英语B'].bottom) : null;
  const gap = byName['体育C'].top - Math.max(byName['高数A'].bottom, byName['英语B'].bottom);
  check('A5 上下相邻的课程块之间留有间隔（不会贴在一起）', gap >= 2, `间隔 ${gap.toFixed(1)}px`);

  // B 组：地点换行（整列宽的长地点必须能完整显示；并排窄块要把空间用满）
  const wide = byName['选修E'];
  check('B1 地点文本完整出现在块里（数据没被截断）', wide?.locText === LONG_LOC, `实际 ${wide?.locText}`);
  check('B2 地点自动换行（整列宽下渲染出多行，而不是挤在一行）', (wide?.locLines ?? 0) >= 2, `行数 ${wide?.locLines}`);
  check('B3 整列宽时地点**完整显示、无一字被裁**', (wide?.locOverflow ?? 99) <= 1, `溢出 ${wide?.locOverflow}px`);
  check(
    'B4 地点不再被人为限制成 1 行（行数上限已按块高放宽）',
    wide?.locClamp === 'none' || Number(wide?.locClamp) >= 3,
    `line-clamp=${wide?.locClamp}`,
  );
  check('B5 课程块整体内容不溢出（不会把地点挤出块外）', (wide?.blockOverflow ?? 99) <= 1, `块内溢出 ${wide?.blockOverflow}px`);

  // 并排窄块（宽约 22px）：物理上放不下全部文字，但必须把可用高度用满
  const narrowBlk = byName['高数A'];
  const narrowAvail = (narrowBlk?.h ?? 0) - 21 - 6;
  check(
    'B6 并排窄块也把地点空间用满（不是只显示一行）',
    (narrowBlk?.locClientH ?? 0) >= 0.6 * narrowAvail && (narrowBlk?.locLines ?? 0) >= 2,
    `地点区高 ${narrowBlk?.locClientH}px / 可用 ${narrowAvail}px，行数 ${narrowBlk?.locLines}`,
  );

  /* ---------------- C/D. 图片尺寸放宽 + 双指缩放 ---------------- */
  await h.clickText('设置', 'r.top > 640');
  await sleep(800);

  const dir = join(tmpdir(), 'dsh-verify-crop');
  mkdirSync(dir, { recursive: true });
  // 300×400：低于旧下限 600px，但高于新的硬下限 120px → 新策略下应当**可用**
  const smallPng = join(dir, 'small-300x400.png');
  writeFileSync(smallPng, makePng(300, 400));

  const inj = await h.injectFile(() => h.clickText('选择背景图'), smallPng);
  check('C1 能注入一张 300×400 的小图（旧版会被直接拒绝）', inj.injected, JSON.stringify(inj.chooser ?? null));
  await sleep(1600);
  check('C2 小图不再被拒绝：直接进入裁剪环节', await h.cropModalVisible());

  const size0 = await h.readCropSize();
  check('C3 裁剪器给出实时裁剪尺寸', !!size0 && size0.w > 0 && size0.h > 0, `${size0?.w}×${size0?.h}`);

  const hints = JSON.parse(
    await evalJs(`(() => {
      const t = document.body.innerText;
      return JSON.stringify({
        target: /该比例建议\\s*≥\\s*\\d+\\s*×\\s*\\d+/.test(t),
        grade: /(清晰|够用|偏小|很小)（最短边\\s*\\d+px/.test(t),
        pinchHint: t.includes('双指捏合'),
      });
    })()`),
  );
  check('C4 显示「建议目标尺寸」（按指定尺寸裁剪即可用）', hints.target);
  check('C5 显示按裁剪后尺寸的分级评价（不再一律拒绝小图）', hints.grade);
  check('C6 裁剪界面有双指缩放的操作提示', hints.pinchHint);

  // D 组：真实触摸事件做双指捏合
  const frame = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const els = [...document.querySelectorAll('div')].filter(e => e.getAttribute('aria-label') === '裁剪预览框' && visible(e));
      if (!els.length) return 'null';
      const r = els[els.length - 1].getBoundingClientRect();
      return JSON.stringify({ cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) });
    })()`),
  );
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const { cx, cy } = frame;
  /**
   * 用 Chrome 的**合成捏合**（Input.synthesizePinchGesture）而不是手工拼 touchStart/Move/End：
   * 手工序列在 RN Web 上会让响应者（responder）保持被占用，之后连按钮都点不动，
   * 而合成捏合走的是完整的真实触摸语义，结束后页面照常响应。
   */
  await browser.send('Input.synthesizePinchGesture', {
    x: cx,
    y: cy,
    scaleFactor: 2,
    relativeSpeed: 800,
    gestureSourceType: 'touch',
  });
  await sleep(600);

  const size1 = await h.readCropSize();
  check(
    'D1 双指捏合能放大（裁剪范围随之变小）',
    !!size1 && !!size0 && size1.w < size0.w && size1.h < size0.h,
    `捏合前 ${size0?.w}×${size0?.h} → 捏合后 ${size1?.w}×${size1?.h}`,
  );

  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await sleep(200);
  await h.clickText('取消');
  await sleep(700);
  check('D2 双指缩放后仍能关闭裁剪弹层（输入未被卡住）', !(await h.cropModalVisible()));

  console.log(`\n通过：${OK.length}/${OK.length + PROBLEMS.length}`);
  if (PROBLEMS.length) {
    console.log('\n未通过：');
    for (const p of PROBLEMS) console.log('  ❌', p);
  }
} finally {
  browser.close();
}

process.exit(PROBLEMS.length === 0 ? 0 : 1);
