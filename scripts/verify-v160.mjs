/**
 * v1.6.0 四项改动的浏览器端验证
 *
 * 覆盖（对应本轮需求）：
 *  A. BUG 修复：界面主题色（强调色）能真正生效
 *     A1 种子里把强调色设为红色 → 浮动按钮就是红色（修复前恒为默认靛蓝）
 *     A2 在设置里点绿色色块 → 回到课表页浮动按钮变绿（改设置即刻生效）
 *     A3 底部标签高亮条随之变色
 *  B. 周视图边栏时间轴：每节同时显示开始与结束时间
 *     B1 第 N 节的两个时间都在，且结束时间在开始时间下方同一列
 *     B2 全部节次都有成对时间
 *     B3 时间轴位于「周一」列左侧（确实在边栏里）
 *  C. 添加课程：星期可多选
 *     C1 勾选周二、周四后，周一仍处于选中态（多选而非单选）
 *     C2 提交后生成 3 条课程（周一/周二/周四各一条），其余字段一致
 *  D. 自定义主题：选图后的裁剪环节
 *     D1 已有图片可「重新裁剪」，弹层打开且初始裁剪尺寸 = 已保存的裁剪
 *     D2 点「＋」放大后，裁剪尺寸变小
 *     D3 拖动图片后裁剪范围改变
 *     D4 「使用这张」把新裁剪写回设置（且不重选图片）
 *     D5 背景图渲染后「裁剪区域覆盖容器」（无黑边）
 *     D6 真实选图链路：注入 PNG 文件 → 打开裁剪器 → 确认 → 图片与裁剪记录双双写入
 *
 * 用法：node scripts/verify-v160.mjs（需先 npx expo export --platform web --output-dir .webcheck）
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { withBrowser } from './lib/browser.mjs';
import { makePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, '.webcheck');

const SCREEN = { w: 393, h: 850 }; // 与 withBrowser 默认视口一致
const SRC = { width: 1200, height: 1600 };

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

/** 节次时间：第 1 节 08:30-09:15，用于验证边栏显示配对时间 */
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

const courses = [
  { id: 'c1', name: '高等数学A', teacher: '张三', location: '教一101', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3, 4, 5, 6, 7, 8], color: '#6366F1' },
  { id: 'c2', name: '大学英语', teacher: '李四', location: '教二203', dayOfWeek: 3, startPeriod: 3, endPeriod: 4, weeks: [1, 2, 3, 4, 5, 6, 7, 8], color: '#8B5CF6' },
];

// 已保存的裁剪：宽高比刻意等于屏幕比例，这样初始「裁剪后」尺寸可精确预期
const CROP_W = 0.4;
const cropH = ((CROP_W * SRC.width) / (SCREEN.w / SCREEN.h)) / SRC.height;
const seededCrop = { rect: { x: 0.25, y: 0.15, w: CROP_W, h: +cropH.toFixed(6) }, source: SRC };
const expectedInit = { w: Math.round(CROP_W * SRC.width), h: Math.round(cropH * SRC.height) };

const seededImage = `data:image/png;base64,${makePng(24, 32).toString('base64')}`;

const settings = {
  semesterStart,
  totalWeeks: 18,
  periods,
  accentColor: '#EF4444', // 红色：用于验证「强调色生效」
  backgroundImage: seededImage,
  backgroundOverlay: 0.5,
  themeCrop: { background: seededCrop, icon: null },
  dynamicIsland: true,
  glassEnabled: false,
  ai: { baseURL: '', apiKey: '', model: '', visionModel: '' },
  jwc: { loginURL: '', timetableURL: '', note: '' },
  meta: { school: '示例大学' },
  // v1.7.1 起设置页默认是「分类抽屉」；本脚本聚焦 v1.6 的裁剪/主题，用平铺模式免得先展开抽屉
  settingsDrawer: false,
};

const PROBLEMS = [];
const OK = [];
function check(label, ok, detail = '') {
  (ok ? OK : PROBLEMS).push(label + (detail ? `  —— ${detail}` : ''));
  console.log(ok ? '✅' : '❌', label, detail ? `(${detail})` : '');
}

const browser = await withBrowser({ dist, port: 8804, cdpPort: 9346, seed: { courses, settings } });
const { evalJs } = browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 可见性判定（本项目踩过的坑 #4）：
 * RN Web 的 Modal **关闭后仍留在 DOM 里**（只是隐藏），
 * 因此按文本找元素时必须剔除不可见命中，否则会点到"已经关掉的弹层"里的同名按钮
 * —— 这正是本轮验证最初 3 项误报的原因。
 */
const VISIBLE = `(e => {
  let el = e;
  for (let i = 0; i < 12 && el; i++) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    el = el.parentElement;
  }
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
})`;

/** 精确定位某段文字中**可见**的一个（可附加 rect 过滤条件）；先滚入视口保证可点 */
const locate = async (text, filter = 'true') =>
  evalJs(`(() => {
    const visible = ${VISIBLE};
    const all = [...document.querySelectorAll('div,span')];
    const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(text)} && visible(e));
    if (!hits.length) return 'null';
    const el = hits[hits.length - 1];
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (!(${filter})) return 'filtered';
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) });
  })()`);

const clickText = async (text, filter = 'true') => {
  const raw = await locate(text, filter);
  if (!raw || raw === 'null' || raw === 'filtered') return false;
  const p = JSON.parse(raw);
  await browser.clickAt(p.x, p.y);
  return true;
};

/** 取某段文字所在元素（或最近祖先）的背景色 */
const bgOfText = async (text) =>
  evalJs(`(() => {
    const all = [...document.querySelectorAll('div,span')];
    const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(text)});
    if (!hits.length) return 'no-text';
    let el = hits[hits.length - 1];
    for (let i = 0; i < 6 && el; i++) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg.replace(/\\s+/g, '');
      el = el.parentElement;
    }
    return 'none';
  })()`);

/**
 * 取底部标签「高亮条」的颜色。
 * 注意：高亮条是标签文字的**兄弟节点**（不是祖先），所以不能靠向上遍历取色
 * ——第一次就是这里取成了标签栏底色，误报了 2 项。
 */
const tabIndicatorColor = async (label) =>
  evalJs(`(() => {
    const all = [...document.querySelectorAll('div,span')];
    const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(label)});
    if (!hits.length) return 'no-text';
    let el = hits[hits.length - 1];
    for (let up = 0; up < 4 && el; up++) {
      const cands = [...el.querySelectorAll('div')].filter(d => {
        const r = d.getBoundingClientRect();
        return r.width > 8 && r.width < 26 && r.height > 1 && r.height < 6;
      });
      if (cands.length) return getComputedStyle(cands[cands.length - 1]).backgroundColor.replace(/\\s+/g, '');
      el = el.parentElement;
    }
    return 'none';
  })()`);

const readStore = async (key) => {
  const raw = await evalJs(`localStorage.getItem(${JSON.stringify(key)})`);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** 以 React 兼容方式写入输入框（受控组件必须走原生 value setter + input 事件） */
const setInput = async (idx, text) =>
  evalJs(`(() => {
    const els = [...document.querySelectorAll('input,textarea')].filter(e => e.getClientRects().length);
    const el = els[${idx}];
    if (!el) return 'no-el:' + els.length;
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);

/** 取「裁剪后 W × H」 */
const readCropSize = async () => {
  const t = await evalJs(`(() => {
    const m = document.body.innerText.match(/裁剪后\\s*(\\d+)\\s*×\\s*(\\d+)/);
    return m ? m[1] + 'x' + m[2] : 'none';
  })()`);
  if (!t || t === 'none') return null;
  const [w, h] = t.split('x').map(Number);
  return { w, h };
};

/** 裁剪弹层是否可见（RN Web 的 Modal 关闭后可能仍在 DOM，必须查可见性） */
const cropModalVisible = async () =>
  evalJs(`(() => {
    const all = [...document.querySelectorAll('div,span')];
    const title = all.filter(e => (e.textContent || '').trim() === '裁剪背景图').pop();
    if (!title) return false;
    let el = title;
    for (let i = 0; i < 12 && el; i++) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) return false;
      el = el.parentElement;
    }
    return true;
  })()`);

try {
  await browser.navigate('/');
  await browser.waitFor(`document.body && document.body.innerText.includes('大学课表')`);
  await sleep(1200);

  /* ---------------- A. 强调色 ---------------- */

  const fabRed = await bgOfText('＋');
  check('A1 强调色生效：种子里设为红色后，浮动按钮即为红色', fabRed === 'rgb(239,68,68)', `实际 ${fabRed}`);

  const tabRed = await tabIndicatorColor('课表');
  check('A1b 底部标签高亮条跟随强调色（红色）', tabRed === 'rgb(239,68,68)', `实际 ${tabRed}`);

  // 进设置页换强调色
  const toSettings = await clickText('设置', 'r.top > 640');
  check('A2 能切到设置页', toSettings);
  await sleep(700);
  const pickedGreen = await evalJs(`(() => {
    const all = [...document.querySelectorAll('div')];
    const el = all.find(e => {
      const bg = getComputedStyle(e).backgroundColor;
      const r = e.getBoundingClientRect();
      return bg === 'rgb(16, 185, 129)' && r.width > 20 && r.width < 60 && Math.abs(r.width - r.height) < 6;
    });
    if (!el) return 'null';
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (pickedGreen && pickedGreen !== 'null') {
    const p = JSON.parse(pickedGreen);
    await browser.clickAt(p.x, p.y);
    await sleep(700);
  }
  const storedAccent = (await readStore('univtimetable/settings/v1'))?.accentColor;
  check('A2 点击绿色色块后设置已写入', storedAccent === '#10B981', `实际 ${storedAccent}`);

  const backToTimetable = await clickText('课表', 'r.top > 640');
  check('A2b 能切回课表页', backToTimetable);
  await sleep(700);
  const fabGreen = await bgOfText('＋');
  check(
    'A2c 强调色改设置后立即生效（浮动按钮由红变绿，修复前不会变）',
    fabGreen === 'rgb(16,185,129)',
    `实际 ${fabGreen}`,
  );
  const tabGreen = await tabIndicatorColor('课表');
  check('A2d 底部标签高亮条同步变绿', tabGreen === 'rgb(16,185,129)', `实际 ${tabGreen}`);

  /* ---------------- B. 边栏时间轴（开始 + 结束） ---------------- */

  const toWeek = await clickText('周');
  check('B0 能切到「周」视图', toWeek);
  await sleep(900);

  const gutter = JSON.parse(
    await evalJs(`(() => {
      const leaves = [...document.querySelectorAll('div,span')].filter(e => !e.children.length);
      const pick = (t) => {
        const hits = leaves.filter(e => (e.textContent || '').trim() === t);
        if (!hits.length) return null;
        const r = hits[hits.length - 1].getBoundingClientRect();
        return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1) };
      };
      const items = ${JSON.stringify(periods)}.map(p => ({ index: p.index, start: pick(p.start), end: pick(p.end) }));
      const mon = pick('周一');
      return JSON.stringify({ items, monLeft: mon ? mon.x : null });
    })()`),
  );

  const found = gutter.items.filter((it) => it.start && it.end);
  check(
    'B1 每节都同时标出开始与结束时间',
    found.length === gutter.items.length,
    `命中 ${found.length}/${gutter.items.length}`,
  );
  const first = gutter.items[0];
  check(
    'B2 第 1 节显示 08:30 与 09:15 两个时间',
    !!first?.start && !!first?.end && periods[0].start === '08:30' && periods[0].end === '09:15',
    first ? `${first.start ? 'start(y=' + first.start.y + ')' : '缺 start'} / ${first.end ? 'end(y=' + first.end.y + ')' : '缺 end'}` : '未找到',
  );
  const aligned = found.every((it) => Math.abs(it.start.x - it.end.x) <= 4);
  const stacked = found.every((it) => it.end.y - it.start.y > 0 && it.end.y - it.start.y < 22);
  check('B3 结束时间紧跟在开始时间下方、同列对齐', aligned && stacked, `对齐=${aligned} 纵向差=${found[0] ? (found[0].end.y - found[0].start.y).toFixed(1) : '-'}`);
  const inGutter =
    gutter.monLeft != null && found.every((it) => it.start.right <= gutter.monLeft + 0.5 && it.end.right <= gutter.monLeft + 0.5);
  check('B4 两个时间都在「周一」列左侧的边栏内', inGutter, `周一列 x=${gutter.monLeft}`);

  /* ---------------- C. 星期多选 ---------------- */

  const openForm = await clickText('＋');
  check('C0 能打开添加课程表单', openForm);
  await sleep(700);
  const typed = await setInput(0, '多选测试课');
  check('C1 能填写课程名称', typed === 'ok', `结果 ${typed}`);

  await clickText('周二');
  await sleep(250);
  await clickText('周四');
  await sleep(400);

  const chipState = JSON.parse(
    await evalJs(`(() => {
      const leaves = [...document.querySelectorAll('div,span')];
      const state = {};
      for (const d of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
        const el = leaves.filter(e => (e.textContent || '').trim() === d).pop();
        if (!el) { state[d] = 'missing'; continue; }
        // 选中态 = 该胶囊自身或最近祖先带强调色边框/底色
        let on = false;
        let cur = el;
        for (let i = 0; i < 4 && cur; i++) {
          const cs = getComputedStyle(cur);
          if (cs.borderColor.includes('16, 185, 129') || cs.backgroundColor.includes('16, 185, 129') || cs.backgroundColor.includes('rgba(16, 185, 129')) { on = true; break; }
          cur = cur.parentElement;
        }
        state[d] = on ? 'on' : 'off';
      }
      return JSON.stringify(state);
    })()`),
  );
  check(
    'C2 星期可多选：周一/周二/周四同时选中（单选实现下只会剩一个）',
    chipState['周一'] === 'on' && chipState['周二'] === 'on' && chipState['周四'] === 'on' && chipState['周三'] === 'off',
    JSON.stringify(chipState),
  );

  const submitted = await clickText('添加到课表（3 天各一条）');
  check('C3 提交按钮按选中天数变化（显示 3 天各一条）', submitted);
  await sleep(900);

  const savedCourses = (await readStore('univtimetable/courses/v1')) || [];
  const made = savedCourses.filter((c) => c.name === '多选测试课');
  const days = made.map((c) => c.dayOfWeek).sort((a, b) => a - b);
  check(
    'C4 提交后生成 3 条课程（周一/周二/周四各一条）',
    made.length === 3 && JSON.stringify(days) === JSON.stringify([1, 2, 4]),
    `条数=${made.length} 星期=${JSON.stringify(days)}`,
  );
  check(
    'C5 三条课程其余字段一致（同节次同周次同颜色）',
    made.length === 3 &&
      made.every(
        (c) =>
          c.startPeriod === made[0].startPeriod &&
          c.endPeriod === made[0].endPeriod &&
          JSON.stringify(c.weeks) === JSON.stringify(made[0].weeks) &&
          c.color === made[0].color,
      ),
  );

  /* ---------------- D. 裁剪 ---------------- */

  await clickText('设置', 'r.top > 640');
  await sleep(700);
  const openRecrop = await clickText('重新裁剪');
  check('D1 已有背景图可进入「重新裁剪」', openRecrop);
  await sleep(900);
  check('D1b 裁剪弹层已打开', await cropModalVisible());

  const init = await readCropSize();
  check(
    'D1c 初始裁剪尺寸 = 已保存的裁剪记录（按屏幕比例的 40% 宽）',
    !!init && init.w === expectedInit.w && init.h === expectedInit.h,
    `期望 ${expectedInit.w}×${expectedInit.h}，实际 ${init ? init.w + '×' + init.h : '未读到'}`,
  );

  const zoomed = await clickText('＋', 'r.top > 600');
  await sleep(500);
  const afterZoom = await readCropSize();
  check(
    'D2 点「＋」放大后裁剪范围变小',
    !!afterZoom && !!init && afterZoom.w < init.w && afterZoom.h < init.h,
    `放大后 ${afterZoom ? afterZoom.w + '×' + afterZoom.h : '未读到'}`,
  );

  // 拖动裁剪框内的图片（用 CDP 真实鼠标事件，合成事件驱动不了 PanResponder）
  const frame = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const els = [...document.querySelectorAll('div')].filter(e => e.getAttribute('aria-label') === '裁剪预览框' && visible(e));
      if (!els.length) return 'null';
      const r = els[els.length - 1].getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`),
  );
  /** 裁剪框内图片的位置（拖动只改变位置、不改变可见区域大小，因此必须量位置） */
  const imgPos = async () =>
    evalJs(`(() => {
      const visible = ${VISIBLE};
      const frames = [...document.querySelectorAll('div')].filter(e => e.getAttribute('aria-label') === '裁剪预览框' && visible(e));
      const img = frames.length ? frames[frames.length - 1].querySelector('img') : null;
      if (!img) return 'none';
      const r = img.getBoundingClientRect();
      return JSON.stringify({ left: +r.left.toFixed(1), top: +r.top.toFixed(1) });
    })()`);
  const before = await imgPos();
  if (frame && frame !== 'null') {
    const f = JSON.parse(JSON.stringify(frame));
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: f.x, y: f.y, buttons: 0 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f.x, y: f.y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(60);
    // 分几步移动：PanResponder 需要连续的 move 事件
    for (const step of [10, 20, 30, 40]) {
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: f.x + step, y: f.y + step, button: 'left', buttons: 1 });
      await sleep(40);
    }
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: f.x + 40, y: f.y + 40, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(400);
  }
  const afterPos = await imgPos();
  const b = before && before !== 'none' ? JSON.parse(before) : null;
  const a = afterPos && afterPos !== 'none' ? JSON.parse(afterPos) : null;
  check(
    'D3 拖动图片能改变裁剪位置（真实鼠标事件驱动 PanResponder）',
    !!a && !!b && (Math.abs(a.left - b.left) > 5 || Math.abs(a.top - b.top) > 5),
    `拖动前 ${before} → 拖动后 ${afterPos}`,
  );
  const afterDrag = await readCropSize();
  check(
    'D3b 拖动只平移不缩放（裁剪尺寸不变）',
    !!afterDrag && !!afterZoom && afterDrag.w === afterZoom.w && afterDrag.h === afterZoom.h,
    `拖动前 ${afterZoom ? afterZoom.w + '×' + afterZoom.h : '-'} → 拖动后 ${afterDrag ? afterDrag.w + '×' + afterDrag.h : '未读到'}`,
  );

  const confirmed = await clickText('使用这张');
  check('D4 点「使用这张」提交裁剪', confirmed);
  await sleep(900);
  const afterSettings = await readStore('univtimetable/settings/v1');
  const newRect = afterSettings?.themeCrop?.background?.rect;
  check(
    'D4b 新裁剪已写回设置（范围小于初始，原图尺寸保留）',
    !!newRect && newRect.w < seededCrop.rect.w && afterSettings?.themeCrop?.background?.source?.width === SRC.width,
    `rect=${JSON.stringify(newRect)}`,
  );
  check('D4c 未重新选图：图片 URI 未变', afterSettings?.backgroundImage === seededImage);

  // D5 渲染不变式：裁剪区域覆盖容器（无黑边）
  // 注意三件事：① RN Web 的 Modal 关闭后仍留在 DOM（需按可见性筛选）；
  // ② RN Web 的 <Image> 外面还包一层 div，真正的裁剪容器是更外层的祖先；
  // ③ 取「覆盖视口且面积最小」的祖先作为裁剪容器（图片自身的定位层面积更大）。
  const cover = JSON.parse(
    await evalJs(`(() => {
      const visible = ${VISIBLE};
      const imgs = [...document.querySelectorAll('img')].filter(e => (e.src || '').startsWith('data:image/png') && visible(e));
      const cands = [];
      for (const img of imgs) {
        let el = img.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          const r = el.getBoundingClientRect();
          if (r.width >= 380 && r.height >= 700) cands.push({ img, box: el, area: r.width * r.height });
          el = el.parentElement;
        }
      }
      if (!cands.length) return 'null';
      cands.sort((a, b) => a.area - b.area);
      const { img, box } = cands[0];
      const b = box.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const scale = r.width / 1200;
      return JSON.stringify({
        box: { left: b.left, top: b.top, w: b.width, h: b.height },
        img: { left: r.left, top: r.top, w: r.width, h: r.height, scale },
      });
    })()`),
  );
  if (cover && cover !== 'null') {
    const scale = cover.img.scale ?? cover.img.w / SRC.width;
    const rect = newRect || seededCrop.rect;
    const region = {
      left: cover.img.left + rect.x * SRC.width * scale,
      top: cover.img.top + rect.y * SRC.height * scale,
      right: cover.img.left + (rect.x + rect.w) * SRC.width * scale,
      bottom: cover.img.top + (rect.y + rect.h) * SRC.height * scale,
    };
    const ok =
      region.left <= cover.box.left + 0.6 &&
      region.top <= cover.box.top + 0.6 &&
      region.right >= cover.box.left + cover.box.w - 0.6 &&
      region.bottom >= cover.box.top + cover.box.h - 0.6;
    check(
      'D5 背景图按裁剪结果渲染，且裁剪区完全覆盖容器（无黑边）',
      ok,
      `区域=${JSON.stringify(region)} 容器=${JSON.stringify(cover.box)}`,
    );
  } else {
    check('D5 背景图按裁剪结果渲染，且裁剪区完全覆盖容器（无黑边）', false, '未找到背景图元素');
  }

  /* ---------------- D6. 真实选图链路（注入文件） ---------------- */

  // 生成一张真实 PNG（1200×1600，满足最短边 ≥ 600px 的规格）
  const dir = join(tmpdir(), 'dsh-verify-crop');
  mkdirSync(dir, { recursive: true });
  const pngPath = join(dir, 'test-1200x1600.png');
  writeFileSync(pngPath, makePng(SRC.width, SRC.height));

  /**
   * 无头环境注入文件必须「拦截文件选择框」：
   * 直接 `DOM.querySelector('input[type=file]')` 常常慢一步——input 在 headless 下
   * 会被立刻当作"已取消"而移除（实测 nodeId=0，注入静默失败）。
   * 因此先开拦截，再从 `Page.fileChooserOpened` 事件里拿 backendNodeId 注入。
   */
  await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = browser.waitForEvent('Page.fileChooserOpened', 8000);
  const startPick = await clickText('选择背景图');
  check('D6 能点击「选择背景图」', startPick);
  const chooserEvent = await chooser;
  check('D6b 选图控件已打开（文件选择被拦截并拿到引用）', !!chooserEvent?.backendNodeId, JSON.stringify(chooserEvent ?? null));

  if (chooserEvent?.backendNodeId) {
    await browser.send('DOM.enable');
    await browser.send('DOM.setFileInputFiles', { backendNodeId: chooserEvent.backendNodeId, files: [pngPath] });
    await sleep(1800);
    check('D6c 选图后进入裁剪环节（无需系统裁剪）', await cropModalVisible());
    const fresh = await readCropSize();
    check(
      'D6d 新图默认整图裁剪（高度 = 原图高 1600，宽度按屏幕比例收紧）',
      !!fresh && fresh.h === SRC.height && fresh.w > 0 && fresh.w < SRC.width,
      `实际 ${fresh ? fresh.w + '×' + fresh.h : '未读到'}`,
    );
    await clickText('使用这张');
    await sleep(1200);
    const afterPick = await readStore('univtimetable/settings/v1');
    check(
      'D6e 确认后图片与裁剪记录一起写入设置',
      typeof afterPick?.backgroundImage === 'string' &&
        afterPick.backgroundImage !== seededImage &&
        afterPick?.themeCrop?.background?.source?.width === SRC.width,
      `image=${String(afterPick?.backgroundImage).slice(0, 30)}… 与种子相同=${afterPick?.backgroundImage === seededImage} 裁剪器仍打开=${await cropModalVisible()}`,
    );
  } else {
    check('D6c 选图后进入裁剪环节（无需系统裁剪）', false, '未拦截到文件选择框，跳过');
    check('D6d 新图默认整图裁剪（高度 = 原图高 1600，宽度按屏幕比例收紧）', false, '跳过');
    check('D6e 确认后图片与裁剪记录一起写入设置', false, '跳过');
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
