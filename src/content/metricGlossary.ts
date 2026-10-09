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
};
