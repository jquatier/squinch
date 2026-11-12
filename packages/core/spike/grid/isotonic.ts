// Placement along a rank is one small optimisation, solved exactly.
//
// Given an ordered row of things, where each would like to sit (`want`), how
// much that matters (`weight`) and the least distance from each one's start to
// the next one's start (`gap`), find the positions that minimise
// Σ weightᵢ·(xᵢ − wantᵢ)² without reordering or overlapping anything.
//
// Substituting yᵢ = xᵢ − (gap₀ + … + gapᵢ₋₁) turns "xᵢ₊₁ ≥ xᵢ + gapᵢ" into
// "y is non-decreasing", which is weighted isotonic regression — solved by
// pool-adjacent-violators in one pass. No iteration, no tolerance, no tie to
// break: the same input gives the same output on every machine.

export function spread(want: readonly number[], weight: readonly number[], gap: readonly number[]): number[] {
  const n = want.length;
  const offset: number[] = [0];
  for (let i = 0; i + 1 < n; i++) offset.push(offset[i] + gap[i]);

  // each block is a run of neighbours pushed against each other; it sits at
  // the weighted mean of what its members wanted
  const blocks: { sum: number; weight: number; size: number }[] = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: weight[i] * (want[i] - offset[i]), weight: weight[i], size: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.weight <= b.sum / b.weight) break;
      blocks.pop();
      a.sum += b.sum; a.weight += b.weight; a.size += b.size;
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.size; k++) out.push(b.sum / b.weight + offset[out.length]);
  return out;
}
