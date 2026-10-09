export interface SampleStats {
  n: number;
  winRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  stdevReturnPct: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Summary statistics over a sample of forward returns (%). Returns null for an empty sample rather than NaN. */
export function computeSampleStats(returns: number[]): SampleStats | null {
  if (returns.length === 0) return null;
  const n = returns.length;
  const avg = returns.reduce((a, b) => a + b, 0) / n;
  const wins = returns.filter((r) => r > 0).length;
  const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / n;
  const sorted = [...returns].sort((a, b) => a - b);
  return {
    n,
    winRatePct: (wins / n) * 100,
    avgReturnPct: avg,
    medianReturnPct: median(sorted),
    stdevReturnPct: Math.sqrt(variance),
  };
}
