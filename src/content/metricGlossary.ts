import type { MetricHelpContent } from "../components/MetricHelp";

export const METRIC_GLOSSARY: Record<string, MetricHelpContent> = {
  return1d: {
    title: "1D Return",
    formula: "((Today's Close / Previous Close) - 1) x 100",
    explanation:
      "Today's price movement versus the previous trading session. Useful for spotting sharp daily moves, but far too short a window to judge a trend.",
    example:
      "If a sector index closed at 1,000 yesterday and 1,020 today, its 1D return is +2%. That alone says nothing about whether the sector is in a longer uptrend or downtrend.",
  },
  return1w: {
    title: "1W Return",
    formula: "((Close today / Close 5 trading sessions ago) - 1) x 100",
    explanation:
      "Recent momentum over roughly the last trading week (5 sessions, not 7 calendar days - weekends and holidays are skipped).",
    example:
      "A sector up 3% over 1W but flat over 1M may just be bouncing within a sideways range rather than genuinely accelerating.",
  },
  return1m: {
    title: "1M Return",
    formula: "((Close today / Close 21 trading sessions ago) - 1) x 100",
    explanation: "Short-term trend over roughly the last month of trading (21 sessions).",
    example: "Used as one of the core inputs to both the strength score and the bullish/bearish classification.",
  },
  return3m: {
    title: "3M Return",
    formula: "((Close today / Close 63 trading sessions ago) - 1) x 100",
    explanation: "Intermediate-term trend over roughly the last quarter (63 sessions).",
    example: "A sector can be up 1M but still down 3M if it only recently started recovering from a larger decline.",
  },
  return6m: {
    title: "6M Return",
    formula: "((Close today / Close 126 trading sessions ago) - 1) x 100",
    explanation: "Sustained trend over roughly the last six months (126 sessions) - the longest return window this dashboard tracks.",
    example:
      "This is why a sector can show a strong 1D return but still be weak over 3M/6M: a single good day (e.g. a result announcement or a policy tailwind for the sector) can lift the 1D number sharply without undoing months of an underlying downtrend. Always read short-term returns alongside the longer windows.",
  },
  breadth20: {
    title: "% Above 20-DMA",
    formula: "(Constituents trading above their own 20-day moving average / Eligible constituents) x 100",
    explanation:
      "How many of the sector's constituent STOCKS (not the index itself) are in short-term uptrends. High breadth means strength is broad-based across many stocks; low breadth means the index move is being driven by just a few heavyweight stocks.",
    example:
      "If 18 of 20 eligible auto-sector stocks are trading above their own 20-day average, breadth is 90% - a broad, participative move, not just one or two large stocks pulling the index up.",
  },
  breadth50: {
    title: "% Above 50-DMA",
    formula: "(Constituents trading above their own 50-day moving average / Eligible constituents) x 100",
    explanation: "Same idea as the 20-DMA breadth, but for intermediate-term participation (about 2-3 months).",
    example: "A sector can have high 20-DMA breadth (a recent short bounce) but low 50-DMA breadth (still below its intermediate trend) at the same time.",
  },
  breadth200: {
    title: "% Above 200-DMA",
    formula: "(Constituents trading above their own 200-day moving average / Eligible constituents) x 100",
    explanation: "Long-term participation (roughly the last 10 months). Widely watched by trend-following investors as a definition of a long-term uptrend/downtrend.",
    example: "Low 200-DMA breadth even while 1M/3M returns are positive can indicate an early recovery still fighting a larger downtrend, not an established bull phase.",
  },
  distance52w: {
    title: "Distance from 52-Week High",
    formula: "((Current Close / 52-Week High) - 1) x 100",
    explanation:
      "How close the sector is to its highest close in the last year. 0% means it's at a new high; -10% means it is 10% below that high.",
    example: "A sector that is up 3M but still -15% from its 52-week high is recovering, but hasn't yet reclaimed its prior strength.",
  },
  relativePerformance: {
    title: "Relative Performance vs NIFTY 500",
    formula: "Sector Return (%) - NIFTY 500 Return (%), over the same timeframe, in percentage points",
    explanation:
      "Whether the sector is beating or lagging the broad market over that timeframe. A sector can rise in absolute terms yet still underperform if the overall market rose faster.",
    example: "If Auto returned +5% over 3M while NIFTY 500 returned +2%, Auto's 3M relative performance is +3 percentage points - it outperformed the market.",
  },
  rsRatio: {
    title: "Relative Strength (RS) Ratio",
    formula: "Sector Index Close / NIFTY 500 Close",
    explanation:
      "A single ratio tracked over time rather than a single return number. A rising line means the sector is strengthening relative to the broad market; a falling line means it's weakening - regardless of whether the market itself is up or down.",
    example:
      "During a market-wide selloff, a sector whose RS ratio keeps rising is losing less than the market (or even gaining) - a sign of relative leadership even in a weak tape.",
  },
  strengthScore: {
    title: "Sector Strength Score",
    explanation:
      "A transparent count of how many predefined bullish conditions (returns, breadth, relative strength, proximity to the 52-week high) a sector currently passes, out of a possible 9 points. This is a screening heuristic to help compare sectors at a glance - it is NOT a validated predictive model and does not forecast future returns.",
    example:
      "A score of 7/9 with 100% data completeness means the sector passed 7 of the 9 conditions and every condition could be evaluated. A score of 4/5 (not /9) means some conditions couldn't be evaluated due to missing data, so the denominator itself shrank - always check the completeness percentage alongside the score.",
  },
  regime: {
    title: "Market Regime (Bullish / Sideways / Bearish)",
    explanation:
      "A rules-based read of current conditions - not a prediction or a guarantee of future direction. It only describes what the data shows right now (returns, relative strength and breadth agreement). When required data is missing, the sector is marked 'Insufficient data' rather than silently guessed as sideways.",
    example:
      "A sector can be classified bullish on 1M/3M trend and relative strength while still showing a 1M-vs-6M conflict flag, meaning its longer-term trend disagrees with the recent move - worth reading the stated reasons, not just the label.",
  },
  confidence: {
    title: "Confidence Indicator",
    explanation:
      "A heuristic indicator of how complete and internally consistent the inputs behind a regime classification are - NOT a statistically calibrated probability of anything. 'High' means all required data was available and the signals agreed; 'Low' means data was missing or signals conflicted.",
    example: "This dashboard will never claim something like an '80% chance of a breakout' - that would imply a validated statistical model, which this heuristic screening tool is not.",
  },
  industryAggregate: {
    title: "Industry Average Metrics",
    formula: "Equal-weighted average of the industry's own constituent stocks' individually-computed metrics",
    explanation:
      "NSE does not publish a price index for most industry classifications (unlike the 15 NIFTY sectoral indices), so these figures are computed directly by this dashboard as a simple average across real constituent stocks - never an official index value, and never fabricated when data is missing.",
    example:
      "'Capital Goods' average 1M return of -4.9% (n=68) means the 1M returns of 68 real constituent stocks that had enough history were averaged, not that an official 'NIFTY Capital Goods' index fell 4.9% - no such index is published.",
  },
  stockScore: {
    title: "Stock Screening Score",
    explanation:
      "A separate 0-10 scale from the sector/industry 0-9 score (different conditions: 52-week-high proximity, 1M/3M returns, the stock's own 50/200-DMA, 3M relative performance, and the three pattern heuristics below). Like every score in this app, a condition only counts toward the denominator when it could actually be evaluated - a lower 'of N' denominator means some data was missing, not that the stock failed those conditions.",
    example: "A score of 6/9 (not /10) for one stock means one condition - most often a pattern heuristic needing more price history - could not be evaluated at all.",
  },
  patternResistance: {
    title: "Approaching Resistance (heuristic)",
    formula: "Highest intraday high in the trailing lookback window (default 60 sessions), excluding today",
    explanation:
      "Flags a stock trading below that prior swing-high level by less than the configured proximity (default 3%) and not yet closed above it. This is the simplest possible definition of a 'resistance' level - it does not account for how many times the level was tested, trading volume, or any other confirmation.",
    example:
      "A stock whose 60-session high was 500 and is now at 490 (2% below) would be flagged; the same stock at 450 (10% below) would not be, even though 500 is still technically its nearest prior high.",
  },
  patternConsolidation: {
    title: "Consolidation / Range Contraction (heuristic)",
    formula: "Average daily (High-Low)/Close over a short recent window, versus the same measure over a longer baseline window",
    explanation:
      "Flags a stock whose recent trading range has contracted well below its own longer-term baseline range (default: recent 15 sessions under 60% of the baseline 60-session range) - a commonly-watched sign of reduced short-term volatility. It flags contraction only; it does not forecast which direction a subsequent move would go.",
    example:
      "During a broad market selloff, genuine range contraction is rare across most stocks (volatility is elevated, not compressed) - so seeing very few stocks flagged at such times is an expected, not broken, result.",
  },
  patternTriangle: {
    title: "Triangle Price Structure (heuristic)",
    formula: "Linear-regression trendlines fit through recent swing-high and swing-low pivots",
    explanation:
      "Finds local swing highs/lows in a trailing window (default 40 sessions, pivots spaced at least 3 sessions apart), fits a straight line through each set, and classifies the pair of slopes as ascending (flat highs, rising lows), descending (falling highs, flat lows), symmetrical (falling highs, rising lows - converging from both sides), or none. This is a simplified heuristic, not a validated chart-pattern recognizer: it does not check touch count, volume, or fit quality, and 'detected' is not a prediction of a breakout or its direction.",
    example:
      "A stock with 3 swing highs trending down and 3 swing lows trending up over the last 40 sessions would be classified 'symmetrical' - whether that resolves upward, downward, or not at all is exactly what the Backtest tab investigates, with real historical evidence rather than assumption.",
  },
  backtestEdge: {
    title: "Backtest: Edge vs. Baseline",
    formula: "Signal's average net forward return - unconditional baseline's average net forward return, over the same dates/holding period",
    explanation:
      "Whether a screening rule's historical forward returns, net of assumed trading costs, were better or worse than simply holding anything unconditionally over the same period. This is descriptive evidence from a specific historical sample (with real limitations: survivorship bias, a simplified execution assumption, and no significance test) - not a guarantee, and not evidence a rule will keep working.",
    example:
      "If 'Near 52-week high' shows an edge of -0.38pp, stocks flagged by that rule actually underperformed an unconditional hold over the available history - a result worth taking seriously precisely because it is unflattering, not discarding.",
  },
};
