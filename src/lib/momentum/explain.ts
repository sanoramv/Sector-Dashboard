import type { MomentumCandidate } from "../../types/momentum";
import type { OutcomeStats } from "./evaluation";
import { CATEGORY_TEXT } from "./assess";

/** Splits component reasons ("+1 closed at ...", "-2 stretched: ...") into supporting and opposing evidence. */
export function evidenceLists(c: Pick<MomentumCandidate, "assessment">): { supporting: string[]; opposing: string[] } {
  const supporting: string[] = [];
  const opposing: string[] = [];
  for (const comp of c.assessment.components) {
    for (const r of comp.reasons) {
      const m = r.match(/^([+-]?\d+) (.*)$/);
      if (!m) continue;
      (Number(m[1]) > 0 ? supporting : opposing).push(m[2]);
    }
  }
  return { supporting, opposing };
}

/**
 * One-paragraph explanation built ONLY from the candidate's calculated
 * components and the historical statistics passed in - no free text.
 * `history` is the stats for this group and category; `groupHistory` for
 * every top mover in the group (the no-score baseline).
 */
export function explainCandidate(
  c: Pick<MomentumCandidate, "group" | "assessment">,
  history: OutcomeStats | null,
  groupHistory: OutcomeStats | null,
  historyRan: boolean,
): string {
  const { supporting, opposing } = evidenceLists(c);
  const head = CATEGORY_TEXT[c.group][c.assessment.category];
  const parts: string[] = [];
  // Lead with the evidence that defines the category; the other side is the counterpoint.
  const list = (xs: string[], max: number, none: string) => (xs.length > 0 ? xs.slice(0, max).join("; ") : none);
  switch (c.assessment.category) {
    case "insufficient":
      parts.push(c.assessment.rationale);
      break;
    case "continuation":
      parts.push(`${head}: ${list(supporting, 4, "no supporting evidence among the checks")}.`);
      if (opposing.length > 0) parts.push(`Counterpoint: ${list(opposing, 3, "")}.`);
      break;
    case "exhaustion-reversal":
      parts.push(`${head}: ${list(opposing, 4, "warning signs among the checks")}.`);
      if (supporting.length > 0) parts.push(`Counterpoint: ${list(supporting, 3, "")}.`);
      break;
    case "mixed":
      parts.push(`${head}. Supporting: ${list(supporting, 3, "none")}. Against: ${list(opposing, 3, "none")}.`);
      break;
  }
  if (c.assessment.missingEvidence.length > 0) parts.push(`Missing evidence: ${c.assessment.missingEvidence.join(", ")}.`);

  const word = c.group === "gainer" ? "gainers" : "losers";
  let hist: string;
  if (!historyRan) hist = "not yet computed (run the historical evaluation)";
  else if (!history) hist = `no earlier ${word} in this category`;
  else if (!history.sufficient) hist = `insufficient sample (${history.insufficientReason})`;
  else {
    hist =
      `of ${history.n} earlier ${word} in this category (${history.dates} dates), ${history.pctPositive.toFixed(0)}% closed higher the next session` +
      (groupHistory ? `, versus ${groupHistory.pctPositive.toFixed(0)}% of all top ${word}` : "") +
      " - a historical frequency, not a forecast";
  }
  parts.push(`Historical next-session evidence: ${hist}.`);
  return parts.join(" ");
}
