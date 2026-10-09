import { ok, unavailable, type Maybe } from "../../types/metrics";

export interface AggregateResult {
  value: Maybe<number>;
  sampleSize: number;
}

/**
 * Averages whichever of the given Maybe<number> values are actually
 * available, reporting how many contributed. An unavailable input is
 * excluded from the average entirely - never treated as 0 - matching the
 * "missing data is not zero" rule used throughout the calculation engine.
 */
export function averageAvailable(values: Array<Maybe<number>>, emptyReason: string): AggregateResult {
  const avail = values.filter((v): v is { available: true; value: number } => v.available).map((v) => v.value);
  if (avail.length === 0) {
    return { value: unavailable(emptyReason), sampleSize: 0 };
  }
  const sum = avail.reduce((a, b) => a + b, 0);
  return { value: ok(sum / avail.length), sampleSize: avail.length };
}
