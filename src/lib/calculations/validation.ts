import type { DailyBar } from "../../types/market";

export interface ValidationResult {
  bars: DailyBar[];
  warnings: string[];
}

/**
 * Cleans a raw bar series: drops non-positive/NaN prices, removes duplicate
 * dates (keeping the first occurrence and warning), and sorts ascending by
 * date. Every calculation function in this engine assumes its input has
 * already passed through here - they never re-validate, so bad data fails
 * loudly here rather than silently producing wrong numbers downstream.
 */
export function validateBars(rawBars: DailyBar[]): ValidationResult {
  const warnings: string[] = [];
  const seenDates = new Set<string>();
  const cleaned: DailyBar[] = [];

  const sorted = [...rawBars].sort((a, b) => a.date.localeCompare(b.date));

  for (const bar of sorted) {
    const { date, open, high, low, close } = bar;

    if (!date || Number.isNaN(Date.parse(date))) {
      warnings.push(`Dropped bar with invalid date: ${JSON.stringify(bar)}`);
      continue;
    }
    if (![open, high, low, close].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) {
      warnings.push(`Dropped bar for ${date} with non-positive or invalid OHLC value`);
      continue;
    }
    if (seenDates.has(date)) {
      warnings.push(`Dropped duplicate bar for ${date} (kept first occurrence)`);
      continue;
    }
    seenDates.add(date);
    cleaned.push({ date, open, high, low, close });
  }

  return { bars: cleaned, warnings };
}
