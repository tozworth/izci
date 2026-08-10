/**
 * Per-peer render scheduling: picks the next cluster indices to send for one
 * listener, in the priority order defined by the buffered Opus MVP doc:
 *
 * 1. The newest seek target and its startup window.
 * 2. The current authoritative playhead and its protection window.
 * 3. Missing clusters from that point toward the end of the track.
 * 4. Any earlier holes, then speculative work.
 *
 * The function is pure: given the manifest's cluster timeline, the client's
 * received ranges, and what this peer already has in flight, it returns the
 * next indices to enqueue.
 */

export interface RenderSchedulerInput {
  clusterTimeMs: number[];
  targetTimeMs: number;
  aheadMs: number;
  playheadTimeMs: number;
  protectionMs: number;
  /** Inclusive cluster-index ranges the client already holds. */
  receivedRanges: Array<[number, number]>;
  /** Cluster indices already enqueued for this peer in the current epoch. */
  sent: ReadonlySet<number>;
  /** Maximum number of clusters to return per plan. */
  budget?: number;
}

const DEFAULT_BUDGET = 512;

export function planRenderClusters(input: RenderSchedulerInput): number[] {
  const { clusterTimeMs, receivedRanges, sent } = input;
  const clusterCount = clusterTimeMs.length;
  if (clusterCount === 0) return [];

  const budget = Math.max(1, input.budget ?? DEFAULT_BUDGET);
  const isReceived = createRangeMembership(receivedRanges);
  const result: number[] = [];
  const pushed = new Set<number>();

  const push = (index: number): void => {
    if (index < 0 || index >= clusterCount) return;
    if (isReceived(index) || sent.has(index) || pushed.has(index)) return;
    pushed.add(index);
    result.push(index);
  };

  const targetIndex = indexForTime(clusterTimeMs, Math.max(0, input.targetTimeMs));
  const playheadIndex = indexForTime(clusterTimeMs, Math.max(0, input.playheadTimeMs));

  // 1. Startup window after the seek target.
  const startupEnd = advanceToCoverage(clusterTimeMs, targetIndex, input.aheadMs);
  for (let index = targetIndex; index < startupEnd; index += 1) push(index);

  // 2. Protection window after the playhead.
  const protectionEnd = advanceToCoverage(clusterTimeMs, playheadIndex, input.protectionMs);
  for (let index = playheadIndex; index < protectionEnd; index += 1) push(index);

  // 3. Download-ahead from the far edge of both windows toward the end.
  const forwardStart = Math.max(startupEnd, protectionEnd);
  for (let index = forwardStart; index < clusterCount; index += 1) push(index);

  // 4. Earlier holes before the smaller window start, then any stragglers.
  const holeLimit = Math.min(targetIndex, playheadIndex);
  for (let index = 0; index < holeLimit; index += 1) push(index);

  return result.slice(0, budget);
}

export function indexForTime(clusterTimeMs: number[], timeMs: number): number {
  if (clusterTimeMs.length === 0) return 0;
  // The cluster containing a time is the last one whose start is <= time.
  let low = 0;
  let high = clusterTimeMs.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (clusterTimeMs[middle] <= timeMs) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function advanceToCoverage(clusterTimeMs: number[], start: number, coverageMs: number): number {
  if (coverageMs <= 0) return start + 1;
  const startTime = clusterTimeMs[start];
  let index = start;
  while (index + 1 < clusterTimeMs.length && clusterTimeMs[index + 1] - startTime < coverageMs) {
    index += 1;
  }
  return index + 1;
}

export function createRangeMembership(ranges: Array<[number, number]>): (index: number) => boolean {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  return (index: number): boolean => {
    for (const [start, end] of sorted) {
      if (index < start) return false;
      if (index <= end) return true;
    }
    return false;
  };
}

/**
 * Compacts a set of received cluster indices into inclusive ranges, e.g.
 * {0,1,2,5} -> [[0,2],[5,5]].
 */
export function compactClusterRanges(indices: Iterable<number>): Array<[number, number]> {
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const index of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && index === last[1] + 1) last[1] = index;
    else ranges.push([index, index]);
  }
  return ranges;
}
