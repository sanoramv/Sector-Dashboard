import { describe, it, expect } from "vitest";
import { validateBars } from "../../src/lib/calculations/validation";

describe("validateBars", () => {
  it("sorts bars ascending by date regardless of input order", () => {
    const { bars } = validateBars([
      { date: "2024-01-03", open: 1, high: 1, low: 1, close: 1 },
      { date: "2024-01-01", open: 1, high: 1, low: 1, close: 1 },
      { date: "2024-01-02", open: 1, high: 1, low: 1, close: 1 },
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });

  it("drops bars with zero or negative prices and warns", () => {
    const { bars, warnings } = validateBars([
      { date: "2024-01-01", open: 10, high: 10, low: 10, close: 10 },
      { date: "2024-01-02", open: 0, high: 0, low: 0, close: 0 },
      { date: "2024-01-03", open: -5, high: -5, low: -5, close: -5 },
    ]);
    expect(bars).toHaveLength(1);
    expect(warnings.length).toBe(2);
  });

  it("drops duplicate dates, keeping the first occurrence, and warns", () => {
    const { bars, warnings } = validateBars([
      { date: "2024-01-01", open: 10, high: 10, low: 10, close: 10 },
      { date: "2024-01-01", open: 99, high: 99, low: 99, close: 99 },
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(10);
    expect(warnings[0]).toMatch(/duplicate/i);
  });

  it("drops bars with invalid/unparseable dates", () => {
    const { bars, warnings } = validateBars([
      { date: "not-a-date", open: 10, high: 10, low: 10, close: 10 },
      { date: "2024-01-01", open: 10, high: 10, low: 10, close: 10 },
    ]);
    expect(bars).toHaveLength(1);
    expect(warnings[0]).toMatch(/invalid date/i);
  });

  it("returns an empty array for empty input without throwing", () => {
    const { bars, warnings } = validateBars([]);
    expect(bars).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
