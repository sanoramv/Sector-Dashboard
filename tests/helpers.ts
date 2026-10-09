import type { DailyBar } from "../src/types/market";

/** Builds a sequential daily-bar series (one calendar day apart) from a list of closes. Open/high/low are derived trivially from close for test convenience. */
export function makeBars(closes: number[], startDate = "2024-01-01"): DailyBar[] {
  const start = new Date(startDate + "T00:00:00Z");
  return closes.map((close, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
    };
  });
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
