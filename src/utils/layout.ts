/**
 * 课表网格的**分列排布**（纯函数，可单测）
 *
 * 解决什么问题（v1.7.0 BUG 修复）：
 * 原先同一天的所有课程块都用 `left/right = 1` 铺满整列，一旦两门课时间重叠
 * （节次区间有交集，包括完全相同的情况），后画的块会把先画的**整块盖住**
 * ——用户看到的就是「课程图标重合、有一门课完全看不见」。
 *
 * 做法：把同一天重叠的课程分到不同「列」（lane），并让同一「簇」（互相重叠的连通块）
 * 里的所有块**等宽**排布：
 *   - 互不重叠的课仍占满整列（不会被无谓压窄）；
 *   - 同一时刻重叠的课并排显示，既不遮挡也都能点到。
 *
 * 注意：这是**贪心**分列（按开始节次排序，放进第一条已空出的列），
 * 结果宽度未必是理论最优，但稳定、可预期，且对课表这种小规模输入足够。
 */

export interface LayoutInput {
  id: string;
  startPeriod: number;
  endPeriod: number;
}

export interface Placement {
  /** 第几列（0 起） */
  lane: number;
  /** 所属簇里一共用了几列（用于算宽度） */
  lanes: number;
}

/** 两个节次区间是否有交集（含首尾相接以外的真实重叠） */
export function overlaps(a: LayoutInput, b: LayoutInput): boolean {
  return a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
}

/**
 * 为一组（同一天的）课程分配列位。
 * @returns Map<课程 id, { lane, lanes }>
 */
export function packDayLanes<T extends LayoutInput>(courses: T[]): Map<string, Placement> {
  const result = new Map<string, Placement>();
  if (!courses.length) return result;

  // 开始早的在前；同开始则节数多的在前（大块先占位，避免被小块挤到后面）
  const sorted = [...courses].sort(
    (a, b) =>
      a.startPeriod - b.startPeriod ||
      b.endPeriod - a.endPeriod ||
      a.id.localeCompare(b.id),
  );

  /** 当前簇：clusterStart 之后、且与簇内**任意**课程传递重叠的课程都属于同一簇 */
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  /** 每列的占用结束节次（-Infinity = 空） */
  let laneEnds: number[] = [];
  /** 簇内每条 lane 对应的课程 id（用于回填 lanes 数） */
  let clusterAssign: { id: string; lane: number }[] = [];

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const a of clusterAssign) result.set(a.id, { lane: a.lane, lanes });
    cluster = [];
    clusterAssign = [];
    laneEnds = [];
  };

  for (const c of sorted) {
    // 与当前簇完全脱开（开始节次晚于簇内最大结束节次）→ 结算上一簇
    if (cluster.length && c.startPeriod > clusterEnd) flush();

    // 找第一条"已经空出来"的列：该列最后一门课的结束节次 < 本课开始节次
    let lane = laneEnds.findIndex((end) => end < c.startPeriod);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(c.endPeriod);
    } else {
      laneEnds[lane] = c.endPeriod;
    }

    cluster.push(c);
    clusterEnd = Math.max(clusterEnd === -Infinity ? c.endPeriod : clusterEnd, c.endPeriod);
    clusterAssign.push({ id: c.id, lane });
  }
  flush();

  return result;
}

/**
 * 把「第几列 / 共几列」换算成**百分比**横向位置（v1.7.2）。
 *
 * 为什么用百分比而不是像素：像素版需要先知道本列宽度，而列宽一旦算错（容器内边距、
 * 负边距、机型差异…）就会把块推到相邻列去 —— 这正是"周六/周日课程挤在一列"这类
 * 跨列错乱的可能来源。百分比是相对**本列**的，数学上不可能越出自己那一列。
 *
 * @returns leftPct 左偏移（%）、widthPct 宽度（%）、isLast 是否为最后一列（用于留空隙）
 */
export function lanePercent(
  lane: number,
  lanes: number,
): { leftPct: number; widthPct: number; isLast: boolean } {
  const n = Math.max(1, Math.floor(lanes));
  const idx = Math.min(Math.max(0, Math.floor(lane)), n - 1);
  const widthPct = 100 / n;
  return { leftPct: idx * widthPct, widthPct, isLast: idx === n - 1 };
}
