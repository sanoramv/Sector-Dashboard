import { describe, it, expect } from "vitest";
import { computeRegime } from "../../src/lib/calculations/regime";
import { ok, unavailable } from "../../src/types/metrics";
import { DEFAULT_SETTINGS } from "../../src/types/config";

describe("computeRegime", () => {
  it("classifies bullish when returns, relative performance and breadth all align positively", () => {
    const result = computeRegime(
      {
        return1m: ok(5),
        return3m: ok(8),
        return6m: ok(10),
        relativePerformance3m: ok(2),
        breadth20: ok(60),
        breadth50: ok(65),
        breadth200: ok(55),
      },
      DEFAULT_SETTINGS.regime,
    );
    expect(result.regime).toBe("bullish");
    expect(result.confidence).toBe("high");
  });

  it("classifies bearish when returns, relative performance and breadth all align negatively", () => {
    const result = computeRegime(
      {
        return1m: ok(-5),
        return3m: ok(-8),
        return6m: ok(-10),
        relativePerformance3m: ok(-2),
        breadth20: ok(30),
        breadth50: ok(25),
        breadth200: ok(35),
      },
      DEFAULT_SETTINGS.regime,
    );
    expect(result.regime).toBe("bearish");
  });

  it("classifies sideways/mixed when conditions are mixed rather than cleanly bullish or bearish", () => {
    const result = computeRegime(
      {
        return1m: ok(5),
        return3m: ok(8),
        return6m: ok(10),
        relativePerformance3m: ok(-1), // breaks the bullish rule
        breadth20: ok(60),
        breadth50: ok(65),
        breadth200: ok(55),
      },
      DEFAULT_SETTINGS.regime,
    );
    expect(result.regime).toBe("sideways");
  });

  it("never silently classifies missing required data as sideways - returns insufficient-data instead", () => {
    const result = computeRegime(
      {
        return1m: ok(5),
        return3m: unavailable("no data"),
        return6m: ok(10),
        relativePerformance3m: ok(2),
        breadth20: ok(60),
        breadth50: ok(65),
        breadth200: ok(55),
      },
      DEFAULT_SETTINGS.regime,
    );
    expect(result.regime).toBe("insufficient-data");
    expect(result.confidence).toBe("low");
  });

  it("returns insufficient-data when fewer breadth measures are available than required", () => {
    const result = computeRegime(
      {
        return1m: ok(5),
        return3m: ok(8),
        return6m: ok(10),
        relativePerformance3m: ok(2),
        breadth20: ok(60),
        breadth50: unavailable("no data"),
        breadth200: unavailable("no data"),
      },
      DEFAULT_SETTINGS.regime,
    );
    expect(result.regime).toBe("insufficient-data");
  });

  it("flags a conflict between 1M and 6M trend direction and lowers confidence", () => {
    const result = computeRegime(
      {
        return1m: ok(5),
        return3m: ok(8),
        return6m: ok(-10), // conflicts with the 1M uptrend
        relativePerformance3m: ok(2),
        breadth20: ok(60),
        breadth50: ok(65),
        breadth200: ok(55),
      },
      DEFAULT_SETTINGS.regime,
    );
    expect(result.shortVsLongConflict).toBe(true);
    expect(result.confidence).not.toBe("high");
  });

  it("classifies bullish from returns and breadth alone when relative performance is self-referential and exempted", () => {
    // Relative performance is exactly 0 (a benchmark vs itself) - with the
    // default (required) behaviour this would block bullish forever.
    const inputWithSelfRS = {
      return1m: ok(5),
      return3m: ok(8),
      return6m: ok(10),
      relativePerformance3m: ok(0),
      breadth20: ok(60),
      breadth50: ok(65),
      breadth200: ok(55),
    };
    const requiredResult = computeRegime(inputWithSelfRS, DEFAULT_SETTINGS.regime);
    expect(requiredResult.regime).toBe("sideways"); // blocked: rs3m (0) is not > 0

    const exemptedResult = computeRegime(inputWithSelfRS, DEFAULT_SETTINGS.regime, { requireRelativePerformance: false });
    expect(exemptedResult.regime).toBe("bullish");
    expect(exemptedResult.reasons.some((r) => /not meaningful/i.test(r))).toBe(true);
  });

  it("does not require relative performance to be available when exempted, and still classifies", () => {
    const result = computeRegime(
      {
        return1m: ok(-5),
        return3m: ok(-8),
        return6m: ok(-10),
        relativePerformance3m: unavailable("not meaningful: compared against itself"),
        breadth20: ok(30),
        breadth50: ok(25),
        breadth200: ok(35),
      },
      DEFAULT_SETTINGS.regime,
      { requireRelativePerformance: false },
    );
    expect(result.regime).toBe("bearish");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      return1m: ok(5),
      return3m: ok(8),
      return6m: ok(10),
      relativePerformance3m: ok(2),
      breadth20: ok(60),
      breadth50: ok(65),
      breadth200: ok(55),
    };
    expect(computeRegime(input, DEFAULT_SETTINGS.regime)).toEqual(computeRegime(input, DEFAULT_SETTINGS.regime));
  });
});
