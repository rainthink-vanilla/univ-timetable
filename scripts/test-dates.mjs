/**
 * 周次 / 日期工具测试（「按周次列表」依赖的正确性）
 *
 * 运行：npm run test:dates
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentWeekNumber,
  mondayOfWeek,
  semesterWeekCount,
  toISODate,
  weekDateRange,
  weekRangeLabel,
} from '../.test-build/utils/date.js';
import { weeksLabel } from '../.test-build/utils/select.js';

test('第几周按「周一对齐」计算，不因跨月/跨年算错', () => {
  assert.equal(currentWeekNumber('2025-09-01', new Date(2025, 8, 1)), 1); // 周一
  assert.equal(currentWeekNumber('2025-09-01', new Date(2025, 8, 7)), 1); // 周日仍属第 1 周
  assert.equal(currentWeekNumber('2025-09-01', new Date(2025, 8, 8)), 2); // 下一个周一 → 第 2 周
  assert.equal(currentWeekNumber('2025-09-01', new Date(2025, 8, 10)), 2); // 第 2 周周四
  assert.equal(currentWeekNumber('2025-12-29', new Date(2026, 0, 5)), 2); // 跨年
});

test('学期开始日期不是周一时，也从所在周的周一起算', () => {
  assert.equal(mondayOfWeek(new Date(2025, 8, 3)).getDate(), 1); // 09-03 是周三 → 所在周周一为 09-01
  assert.equal(currentWeekNumber('2025-09-03', new Date(2025, 8, 3)), 1);
  assert.equal(currentWeekNumber('2025-09-03', new Date(2025, 8, 8)), 2);
});

test('weekDateRange：给出该周的周一 ~ 周日', () => {
  const w1 = weekDateRange('2025-09-01', 1);
  assert.equal(toISODate(w1.start), '2025-09-01');
  assert.equal(toISODate(w1.end), '2025-09-07');

  const w2 = weekDateRange('2025-09-01', 2);
  assert.equal(toISODate(w2.start), '2025-09-08');
  assert.equal(toISODate(w2.end), '2025-09-14');

  const w6 = weekDateRange('2025-09-01', 6); // 跨月
  assert.equal(toISODate(w6.start), '2025-10-06');
  assert.equal(toISODate(w6.end), '2025-10-12');
});

test('weekDateRange：无学期开始日期时兜底到本周，不崩', () => {
  const r = weekDateRange('', 2);
  assert.ok(r.start instanceof Date && !Number.isNaN(r.start.getTime()));
  assert.equal((r.end.getTime() - r.start.getTime()) / 86400000, 6);
});

test('semesterWeekCount：取「设置周数 ∪ 课程实际最大周次」', () => {
  assert.equal(semesterWeekCount(20, 16), 20); // 设置更大 → 用设置值
  assert.equal(semesterWeekCount(16, 18), 18); // 课表排到 18 周 → 不能截掉
  assert.equal(semesterWeekCount(20, 0), 20); // 没有课程
  assert.equal(semesterWeekCount(0, 0), 1); // 下限 1，不显示 0 周
  assert.equal(semesterWeekCount(999, 5), 60); // 上限 60，防脏数据
  assert.equal(semesterWeekCount(NaN, NaN), 20); // 非法值兜底
});

test('weekRangeLabel：格式为 "M/D - M/D"', () => {
  assert.equal(weekRangeLabel('2025-09-01', 1), '9/1 - 9/7');
  assert.equal(weekRangeLabel('2025-09-01', 2), '9/8 - 9/14');
});

test('周次标签：连续段合并、单双周识别，且不产生 undefined', () => {
  // 回归：compressRanges 曾因循环多跑一轮而输出 "1-8,10,undefined"
  assert.equal(weeksLabel([1, 2, 3, 4, 5, 6, 7, 8]), '1-8周');
  assert.equal(weeksLabel([1, 2, 3, 4, 5, 6, 7, 8, 10]), '1-8,10周');
  assert.equal(weeksLabel([1, 3, 5, 7, 9, 11, 13, 15]), '1-15周(单)');
  assert.equal(weeksLabel([2, 4, 6, 8]), '2-8周(双)');
  assert.equal(weeksLabel([]), '未设置周次');
  assert.ok(!weeksLabel([1, 2, 4]).includes('undefined'), '不得出现 undefined');
});
