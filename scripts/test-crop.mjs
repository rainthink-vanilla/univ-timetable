/**
 * v1.6.0 新增纯逻辑测试：强调色令牌 + 图片裁剪几何
 *
 * 运行：npm run test:crop
 * 原理同其他测试：先用 tsc 把 src 编译到 .test-build/，再直接断言
 * **App 里实际使用的那份代码**，不是复制副本。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_TOKENS,
  accentTokens,
  normalizeHex,
  withAlpha,
} from '../.test-build/theme.js';
import {
  FULL_CROP,
  clampTransform,
  cropMeetsMinSide,
  croppedSize,
  fitBox,
  isFullCrop,
  layoutForCrop,
  minScale,
  rectFromTransform,
  transformForCrop,
} from '../.test-build/utils/crop.js';
import { lanePercent, packDayLanes } from '../.test-build/utils/layout.js';
import { coerceDayOfWeek, normalizeStoredCourses } from '../.test-build/utils/select.js';
import { buildCourseCheckReport, reportToText } from '../.test-build/utils/diagnose.js';

/* ---------------- 强调色 ---------------- */

test('强调色：hex 归一化（简写 / 无 # / 大小写 / 非法值）', () => {
  assert.equal(normalizeHex('#6366f1'), '#6366F1');
  assert.equal(normalizeHex('6366F1'), '#6366F1');
  assert.equal(normalizeHex('#abc'), '#AABBCC');
  assert.equal(normalizeHex('#GGGGGG'), null);
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex(''), null);
});

test('强调色：派生半透明色（accentSoft / accentTint）', () => {
  assert.equal(withAlpha('#6366F1', 0.22), 'rgba(99,102,241,0.22)');
  assert.equal(withAlpha('#10B981', 0.14), 'rgba(16,185,129,0.14)');
  // 非法输入回退默认色，alpha 越界被钳制
  assert.equal(withAlpha('not-a-color', 2), withAlpha(DEFAULT_ACCENT, 1));
  assert.equal(withAlpha('#000000', -1), 'rgba(0,0,0,0)');
});

test('强调色：令牌随设置变化（BUG 修复的核心断言）', () => {
  const red = accentTokens('#EF4444');
  assert.equal(red.accent, '#EF4444');
  assert.equal(red.accentSoft, 'rgba(239,68,68,0.22)');
  const green = accentTokens('#10B981');
  assert.notEqual(green.accent, red.accent);
  assert.notEqual(green.accentSoft, red.accentSoft);
  // 非法/缺失 → 默认色（不会出现透明或崩溃）
  assert.deepEqual(accentTokens(null), DEFAULT_ACCENT_TOKENS);
  assert.deepEqual(accentTokens('oops'), DEFAULT_ACCENT_TOKENS);
});

/* ---------------- 裁剪几何 ---------------- */

const SRC = { width: 1200, height: 1600 }; // 竖图 3:4

test('裁剪：全图裁剪等于整图，尺寸换算正确', () => {
  assert.ok(isFullCrop(FULL_CROP));
  assert.ok(isFullCrop(null));
  assert.deepEqual(croppedSize(FULL_CROP, SRC), { width: 1200, height: 1600 });
  // 裁掉上下一半
  assert.deepEqual(croppedSize({ x: 0, y: 0.25, w: 1, h: 0.5 }, SRC), { width: 1200, height: 800 });
});

test('裁剪：最小缩放 = 图片完全覆盖预览框', () => {
  const frame = { w: 300, h: 600 };
  const s = minScale(SRC, frame.w, frame.h);
  // 显示尺寸必须同时 ≥ 框宽与框高
  assert.ok(SRC.width * s >= frame.w - 1e-6);
  assert.ok(SRC.height * s >= frame.h - 1e-6);
  // 而且是最小的那个：再小一点就会有一边盖不住
  assert.ok(SRC.height * (s - 0.001) < frame.h || SRC.width * (s - 0.001) < frame.w);
});

test('裁剪：初始变换在比例一致时把选定区域正好铺满预览框', () => {
  // 预览框 1:2，裁剪区域也取 1:2（源图 3:4 上的 600×1200 区域）
  const frame = { w: 300, h: 600 };
  const rect = { x: 0.25, y: 0.125, w: 0.5, h: 0.75 };
  const tf = transformForCrop(rect, SRC, frame.w, frame.h);
  const back = rectFromTransform(tf, SRC, frame.w, frame.h);
  assert.ok(Math.abs(back.x - rect.x) < 1e-6, `x=${back.x}`);
  assert.ok(Math.abs(back.y - rect.y) < 1e-6, `y=${back.y}`);
  assert.ok(Math.abs(back.w - rect.w) < 1e-6, `w=${back.w}`);
  assert.ok(Math.abs(back.h - rect.h) < 1e-6, `h=${back.h}`);
});

test('裁剪：比例不一致时按 cover 收紧（不会拉伸变形，也不会露黑边）', () => {
  // 预览框 1:2（更瘦），裁剪区域 3:4（更宽）→ 只能保留区域中间的一条
  const frame = { w: 300, h: 600 };
  const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const tf = transformForCrop(rect, SRC, frame.w, frame.h);
  const back = rectFromTransform(tf, SRC, frame.w, frame.h);
  // 高度方向完全用上，宽度方向被收紧到框的宽高比
  assert.ok(Math.abs(back.h - rect.h) < 1e-6, `h=${back.h}`);
  assert.ok(back.w < rect.w, `w=${back.w} 应当小于 ${rect.w}`);
  // 归一化坐标不能直接比比例：要换回像素再比
  const pxW = back.w * SRC.width;
  const pxH = back.h * SRC.height;
  assert.ok(Math.abs(pxW / pxH - frame.w / frame.h) < 1e-6, `像素比例 ${pxW / pxH} 应等于框比例 ${frame.w / frame.h}`);
  // 收紧后的区域必须仍在原选定区域之内
  assert.ok(back.x >= rect.x - 1e-9 && back.x + back.w <= rect.x + rect.w + 1e-9);
});

test('裁剪：拖动到边界时不会露出黑边（钳制生效）', () => {
  const frame = { w: 300, h: 600 };
  const start = transformForCrop(FULL_CROP, SRC, frame.w, frame.h);
  for (const d of [{ dx: 9999, dy: 0 }, { dx: -9999, dy: 0 }, { dx: 0, dy: 9999 }, { dx: 0, dy: -9999 }]) {
    const clamped = clampTransform(
      { scale: start.scale, offsetX: start.offsetX + d.dx, offsetY: start.offsetY + d.dy },
      SRC,
      frame.w,
      frame.h,
    );
    // 图片四条边必须始终在裁剪框之外（即完全盖住框）
    assert.ok(clamped.offsetX <= 1e-6 && clamped.offsetY <= 1e-6, `左/上露白 ${JSON.stringify(clamped)}`);
    assert.ok(
      clamped.offsetX + SRC.width * clamped.scale >= frame.w - 1e-6 &&
        clamped.offsetY + SRC.height * clamped.scale >= frame.h - 1e-6,
      `右/下露白 ${JSON.stringify(clamped)}`,
    );
  }
});

test('裁剪：放大后仍可平移（回归测试：约束对象是整图而不是当前裁剪框）', () => {
  const frame = { w: 300, h: 600 };
  const start = transformForCrop(FULL_CROP, SRC, frame.w, frame.h);
  // 放大 2 倍后应当有可拖动余量
  const zoomed = clampTransform({ scale: start.scale * 2, offsetX: start.offsetX, offsetY: start.offsetY }, SRC, frame.w, frame.h);
  const moved = clampTransform({ scale: zoomed.scale, offsetX: zoomed.offsetX + 20, offsetY: zoomed.offsetY + 20 }, SRC, frame.w, frame.h);
  assert.ok(
    Math.abs(moved.offsetX - zoomed.offsetX) > 1 || Math.abs(moved.offsetY - zoomed.offsetY) > 1,
    `放大后应当能拖动：${JSON.stringify(zoomed)} → ${JSON.stringify(moved)}`,
  );
});

test('裁剪：可反向拉大裁剪范围（原图保留，非破坏性）', () => {
  const frame = { w: 300, h: 600 };
  // 从一个很小的裁剪区域开始（宽高比与预览框一致，便于精确往返比对）
  const small = { x: 0.3, y: 0.3, w: 0.2, h: 0.3 };
  const tf = transformForCrop(small, SRC, frame.w, frame.h);
  const back = rectFromTransform(tf, SRC, frame.w, frame.h);
  assert.ok(Math.abs(back.w - small.w) < 1e-6 && Math.abs(back.h - small.h) < 1e-6, JSON.stringify(back));
  // 缩到最小覆盖缩放 → 裁剪范围应当放大到预览框能容纳的最大区域
  const out = clampTransform(
    { scale: minScale(SRC, frame.w, frame.h), offsetX: -100, offsetY: -100 },
    SRC,
    frame.w,
    frame.h,
  );
  const rect = rectFromTransform(out, SRC, frame.w, frame.h);
  assert.ok(
    rect.w * rect.h > small.w * small.h * 3,
    `应当可以拉大裁剪范围：${JSON.stringify(small)} → ${JSON.stringify(rect)}`,
  );
  // 受限的那一边（高度）应当用满整张图
  assert.ok(Math.abs(rect.h - 1) < 1e-6, `高度应当用满：${rect.h}`);
  assert.ok(rect.w > small.w, `宽度也应变大：${rect.w}`);
});

test('裁剪：放大后可见区域变小，且仍落在原图范围内', () => {
  const frame = { w: 300, h: 600 };
  const base = transformForCrop(FULL_CROP, SRC, frame.w, frame.h);
  const zoomed = clampTransform(
    { scale: base.scale * 2, offsetX: base.offsetX * 2, offsetY: base.offsetY * 2 },
    SRC,
    frame.w,
    frame.h,
  );
  const rect = rectFromTransform(zoomed, SRC, frame.w, frame.h);
  assert.ok(rect.w < 1 && rect.h < 1, `放大后应当只保留部分原图：${JSON.stringify(rect)}`);
  assert.ok(rect.x >= 0 && rect.y >= 0, '裁剪矩形不能越过原图左上角');
  assert.ok(rect.x + rect.w <= 1.000001 && rect.y + rect.h <= 1.000001, '裁剪矩形不能越过原图右下角');
});

test('裁剪：渲染布局（裁剪区域 cover 铺满容器，宽高比一致）', () => {
  const rect = { x: 0.5, y: 0, w: 0.5, h: 0.5 }; // 源图右侧 600×800（3:4）
  const box = { w: 300, h: 400 }; // 容器同为 3:4
  const layout = layoutForCrop(rect, SRC, box.w, box.h);
  assert.ok(layout);
  // 图片整体被放大到 600×800，左边界延伸到容器外 300px，
  // 使得**裁剪区域的左边缘正好落在容器左侧**
  assert.ok(Math.abs(layout.width - 600) < 1e-6, `width=${layout.width}`);
  assert.ok(Math.abs(layout.height - 800) < 1e-6, `height=${layout.height}`);
  assert.ok(Math.abs(layout.left - -300) < 1e-6, `left=${layout.left}`);
  assert.ok(Math.abs(layout.top - 0) < 1e-6, `top=${layout.top}`);
  // 不变式：裁剪区域在容器内恰好铺满（左/上对齐，右/下对齐）
  const scale = layout.width / SRC.width;
  const regionLeft = layout.left + rect.x * SRC.width * scale;
  const regionTop = layout.top + rect.y * SRC.height * scale;
  const regionW = rect.w * SRC.width * scale;
  const regionH = rect.h * SRC.height * scale;
  assert.ok(Math.abs(regionLeft) < 1e-6 && Math.abs(regionTop) < 1e-6, '裁剪区左上角应对齐容器左上角');
  assert.ok(
    Math.abs(regionW - box.w) < 1e-6 && Math.abs(regionH - box.h) < 1e-6,
    '裁剪区应铺满容器',
  );
});

test('裁剪：容器比例不一致时按 cover 居中（不拉伸变形）', () => {
  const layout = layoutForCrop(FULL_CROP, SRC, 400, 400); // 正方形容器 + 3:4 图
  assert.ok(layout);
  const ratio = layout.width / layout.height;
  assert.ok(Math.abs(ratio - SRC.width / SRC.height) < 1e-6, `比例被破坏：${ratio}`);
  assert.ok(layout.height >= 400 - 1e-6 && layout.width >= 400 - 1e-6, '必须完全覆盖容器');
});

test('裁剪：尺寸读不到时布局返回 null（调用方回退普通渲染）', () => {
  assert.equal(layoutForCrop(FULL_CROP, null, 100, 100), null);
  assert.equal(layoutForCrop(FULL_CROP, { width: 0, height: 0 }, 100, 100), null);
  assert.equal(layoutForCrop(FULL_CROP, SRC, 0, 0), null);
});

test('裁剪：预览框按比例取最大居中矩形', () => {
  assert.deepEqual(fitBox(300, 600, 9 / 16), { width: 300, height: 300 / (9 / 16) });
  // 竖屏区域放方框 → 受宽度限制，取 300×300（不会溢出区域）
  assert.deepEqual(fitBox(300, 600, 1), { width: 300, height: 300 });
  // 扁区域放方框 → 受高度限制
  assert.deepEqual(fitBox(900, 300, 1), { width: 300, height: 300 });
  assert.deepEqual(fitBox(0, 600, 1), { width: 0, height: 0 });
});

test('裁剪：最短边规格判定（裁剪过小要给出提示）', () => {
  assert.equal(cropMeetsMinSide({ width: 1200, height: 1600 }, 600), true);
  assert.equal(cropMeetsMinSide({ width: 400, height: 1600 }, 600), false);
  assert.equal(cropMeetsMinSide({ width: 600, height: 600 }, 600), true);
});

/* ---------------- 课程块分列排布（v1.7.0 BUG 修复） ---------------- */

const day = (id, s, e) => ({ id, startPeriod: s, endPeriod: e });

test('分列：互不重叠的课程全部占第 0 列、每簇只有 1 列（不被无谓压窄）', () => {
  const p = packDayLanes([day('a', 1, 2), day('b', 3, 4), day('c', 5, 6)]);
  for (const id of ['a', 'b', 'c']) {
    assert.equal(p.get(id).lane, 0, `${id} 应在第 0 列`);
    assert.equal(p.get(id).lanes, 1, `${id} 所在簇应为单列`);
  }
});

test('分列：节次完全相同的两门课必须并排（原 BUG：后画的盖住先画的）', () => {
  const p = packDayLanes([day('a', 1, 2), day('b', 1, 2)]);
  assert.equal(p.get('a').lanes, 2);
  assert.equal(p.get('b').lanes, 2);
  assert.notEqual(p.get('a').lane, p.get('b').lane, '两门课必须落在不同列');
});

test('分列：部分重叠（1-2 与 2-3）也要分列', () => {
  const p = packDayLanes([day('a', 1, 2), day('b', 2, 3)]);
  assert.notEqual(p.get('a').lane, p.get('b').lane);
  assert.equal(p.get('a').lanes, 2);
});

test('分列：结束节次刚好早于开始节次不算重叠（3-4 与 5-6 可同列）', () => {
  const p = packDayLanes([day('a', 3, 4), day('b', 5, 6)]);
  assert.equal(p.get('a').lane, 0);
  assert.equal(p.get('b').lane, 0);
  assert.equal(p.get('a').lanes, 1);
});

test('分列：三重叠课程分三列，且列号不重复', () => {
  const p = packDayLanes([day('a', 1, 4), day('b', 2, 3), day('c', 3, 5)]);
  const lanes = ['a', 'b', 'c'].map((id) => p.get(id).lane).sort();
  assert.deepEqual(lanes, [0, 1, 2]);
  for (const id of ['a', 'b', 'c']) assert.equal(p.get(id).lanes, 3);
});

test('分列：重叠簇结束后列数重置（不影响后续单课占满整列）', () => {
  // 1-2 与 1-2 重叠（2 列），第 5 节之后的两门课互不重叠 → 各占满整列
  const p = packDayLanes([day('a', 1, 2), day('b', 1, 2), day('c', 5, 6), day('d', 7, 8)]);
  assert.equal(p.get('a').lanes, 2);
  assert.equal(p.get('b').lanes, 2);
  assert.equal(p.get('c').lanes, 1);
  assert.equal(p.get('d').lanes, 1);
  assert.equal(p.get('c').lane, 0);
});

test('分列：空输入不报错', () => {
  assert.equal(packDayLanes([]).size, 0);
});

test('分列：百分比定位——不越出本列、合计正好 100%（v1.7.2 结构保证）', () => {
  // 单列：占满整列
  const one = lanePercent(0, 1);
  assert.deepEqual(one, { leftPct: 0, widthPct: 100, isLast: true });

  for (const n of [2, 3, 4]) {
    const boxes = Array.from({ length: n }, (_, i) => lanePercent(i, n));
    // 每块都在 [0, 100] 内，且不越出本列
    for (const b of boxes) {
      assert.ok(b.leftPct >= 0 && b.leftPct + b.widthPct <= 100 + 1e-9, `第 ${n} 列布局越界：${JSON.stringify(b)}`);
    }
    // 依次紧邻、合计正好铺满
    assert.ok(Math.abs(boxes[n - 1].leftPct + boxes[n - 1].widthPct - 100) < 1e-9, '应正好铺满');
    for (let i = 1; i < n; i++) {
      assert.ok(Math.abs(boxes[i].leftPct - (boxes[i - 1].leftPct + boxes[i - 1].widthPct)) < 1e-9, '应首尾相接不重叠');
    }
    assert.equal(boxes.filter((b) => b.isLast).length, 1, '只有一个"最后一列"');
    assert.ok(boxes[n - 1].isLast);
  }

  // 越界/异常输入被钳制，绝不产生超出本列的定位
  const clampHigh = lanePercent(9, 2);
  const clampLow = lanePercent(-3, 2);
  assert.deepEqual(clampHigh, lanePercent(1, 2));
  assert.deepEqual(clampLow, lanePercent(0, 2));
  assert.deepEqual(lanePercent(0, 0), { leftPct: 0, widthPct: 100, isLast: true }, '列数非法时按单列处理');
});

/* ---------------- v1.7.2：存量脏星期数据兼容 + 课表自检 ---------------- */

test('星期兼容：0 / 字符串 / 中文 / 英文都要能识别（否则课程会落到错列或消失）', () => {
  assert.equal(coerceDayOfWeek(0), 7, '0 视为周日');
  assert.equal(coerceDayOfWeek('0'), 7);
  assert.equal(coerceDayOfWeek('7'), 7);
  assert.equal(coerceDayOfWeek(7), 7);
  assert.equal(coerceDayOfWeek('周日'), 7);
  assert.equal(coerceDayOfWeek('星期日'), 7);
  assert.equal(coerceDayOfWeek('星期天'), 7);
  assert.equal(coerceDayOfWeek('周六'), 6);
  assert.equal(coerceDayOfWeek('星期六'), 6);
  assert.equal(coerceDayOfWeek('Sunday'), 7);
  assert.equal(coerceDayOfWeek('Sun'), 7);
  assert.equal(coerceDayOfWeek('Mon'), 1);
  assert.equal(coerceDayOfWeek(3), 3);
  assert.equal(coerceDayOfWeek(8), null, '越界返回 null');
  assert.equal(coerceDayOfWeek(''), null);
  assert.equal(coerceDayOfWeek(null), null);
  assert.equal(coerceDayOfWeek({}), null);
});

test('星期兼容：启动规整把脏值改成 1~7，并统计修正条数', () => {
  const list = [
    { id: 'a', name: 'A', teacher: '', location: '', dayOfWeek: 0, startPeriod: 1, endPeriod: 2, weeks: [1], color: '#fff' },
    { id: 'b', name: 'B', teacher: '', location: '', dayOfWeek: '7', startPeriod: 1, endPeriod: 2, weeks: [1], color: '#fff' },
    { id: 'c', name: 'C', teacher: '', location: '', dayOfWeek: '周日', startPeriod: 1, endPeriod: 2, weeks: [1], color: '#fff' },
    { id: 'd', name: 'D', teacher: '', location: '', dayOfWeek: 3, startPeriod: 1, endPeriod: 2, weeks: [1], color: '#fff' },
    { id: 'e', name: 'E', teacher: '', location: '', dayOfWeek: '???', startPeriod: 1, endPeriod: 2, weeks: [1], color: '#fff' },
  ];
  const { courses, fixed } = normalizeStoredCourses(list);
  assert.equal(fixed, 4, '4 条需要修正（0/字符串/中文/无法识别）');
  assert.deepEqual(courses.map((c) => c.dayOfWeek), [7, 7, 7, 3, 1], '无法识别的落到周一，其余按识别结果');
  assert.equal(courses.length, list.length, '不得丢课程');
  // 再跑一次应当 0 修正（幂等）
  assert.equal(normalizeStoredCourses(courses).fixed, 0);
});

test('自检：周六有课、周日为空时要给出针对性提示与修复建议', () => {
  const c = (id, day, name, s, e) => ({ id, name, teacher: 'T', location: 'L', dayOfWeek: day, startPeriod: s, endPeriod: e, weeks: [1, 2], color: '#fff' });
  const report = buildCourseCheckReport([c('a', 6, '周末实验', 5, 6), c('b', 1, '高数', 1, 2)], { periods: [{ index: 1, start: '08:00', end: '08:45' }] });
  assert.equal(report.total, 2);
  assert.deepEqual(report.perDay, [1, 0, 0, 0, 0, 1, 0], '周一 1 门、周六 1 门、周日 0 门');
  const titles = report.items.map((i) => i.title).join('\n');
  assert.match(titles, /周六有课、周日没有任何课程/, '应命中周六/周日专项提示');
  const warn = report.items.find((i) => /周六有课/.test(i.title));
  assert.match(warn.detail, /重新导入/, '应给出"重新导入"的建议');
  assert.equal(report.hasProblem, true);
  // 报告可转成纯文本（供分享）
  assert.match(reportToText(report), /大学课表 · 课表自检报告/);
});

test('自检：同一天同一时段同名同地点多条要报"疑似一格多天被压平"', () => {
  const mk = (id) => ({ id, name: '周末实验', teacher: 'T', location: 'L', dayOfWeek: 6, startPeriod: 5, endPeriod: 6, weeks: [1], color: '#fff' });
  const report = buildCourseCheckReport([mk('a'), mk('b')]);
  const dup = report.items.find((i) => /重复课程/.test(i.title));
  assert.ok(dup, '应报出重复组');
  assert.equal(dup.severity, 'error');
  assert.match(dup.detail, /只认了第一个星期|重新导入/);
});

test('自检：星期字段异常、无周次、重复 id 都要被指出', () => {
  const base = { teacher: 'T', location: 'L', startPeriod: 1, endPeriod: 2, weeks: [1], color: '#fff' };
  const report = buildCourseCheckReport([
    { ...base, id: 'x', name: 'A', dayOfWeek: '周日' },
    { ...base, id: 'y', name: 'B', dayOfWeek: 2, weeks: [] },
    { ...base, id: 'z', name: 'C', dayOfWeek: 2 },
    { ...base, id: 'z', name: 'D', dayOfWeek: 3 },
  ]);
  const titles = report.items.map((i) => i.title).join('\n');
  assert.match(titles, /星期字段不规范/);
  assert.match(titles, /没有周次信息/);
  assert.match(titles, /重复的课程 id/);
  assert.equal(report.hasProblem, true);
});

test('自检：数据正常时明确报告"未发现异常"', () => {
  const report = buildCourseCheckReport([
    { id: 'a', name: 'A', teacher: 'T', location: 'L', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3], color: '#fff' },
    { id: 'b', name: 'B', teacher: 'T', location: 'L', dayOfWeek: 7, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3], color: '#fff' },
  ]);
  assert.equal(report.hasProblem, false);
  assert.match(report.items.map((i) => i.title).join('\n'), /未发现异常/);
});

test('自检：空课表要有明确提示', () => {
  const report = buildCourseCheckReport([]);
  assert.equal(report.total, 0);
  assert.equal(report.hasProblem, true);
  assert.match(report.items.map((i) => i.title).join('\n'), /当前没有课程/);
});
