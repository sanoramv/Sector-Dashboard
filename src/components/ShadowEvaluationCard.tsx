import { useEffect, useState } from "react";

/** Shape of public/data/evaluation/shadow-summary.json (scripts/shadow/evaluate.mts); only the fields shown here. */
interface Desc {
  complete: number;
  pending: number;
  adverse: number | null;
  confirmed: number | null;
  meanX: number | null;
  netT: Record<string, number | null>;
}
interface Contrast {
  diff: number | null;
  ci95: [number | null, number | null];
  p: number | null;
}
interface ShadowVariant {
  variant: string;
  versionId: string;
  definition: string;
  sessions: { files: number; eligible: number };
  checkpoint: { reached: number | null; next: number | null; decisionLook: boolean };
  signalsPerSession: number | null;
  mv1SignalsPerSession: number | null;
  horizons: Record<string, { variant: Desc; mv1: Desc }>;
  primary: { P1: Contrast; P2: Contrast; P3: Contrast };
}
interface ShadowSummary {
  experimental: true;
  benchmark: { ruleVersion: string; cohort: string };
  note: string;
  variants: ShadowVariant[];
}

const NAMES: Record<string, string> = { "bo-wide": "BO-wide", "bo-raw": "BO-raw", "bo-cap10": "BO-cap10" };
const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x.toFixed(d));
const sg = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(d)}`);
const ci = (c: Contrast, d = 1) => (
  <>
    {sg(c.diff, d)}
    {c.ci95[0] !== null && (
      <span className="text-faint" style={{ fontSize: 10.5 }}>
        {" "}
        [{sg(c.ci95[0], d)}, {sg(c.ci95[1], d)}]
      </span>
    )}
  </>
);
const td = { padding: "4px 8px", whiteSpace: "nowrap" as const };

/** EXPERIMENTAL shadow rules beside the production benchmark (docs/research/SHADOW_PREDICTIONS.md). Hidden until data exists. */
export function ShadowEvaluationCard({ base, h }: { base: string; h: number }) {
  const [s, setS] = useState<ShadowSummary | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`${base}/shadow-summary.json`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => setS(x && x.experimental === true && Array.isArray(x.variants) ? x : null))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [base]);
  if (!s) return null;
  const k = `h${h}`;
  return (
    <div className="card" style={{ padding: 14, borderStyle: "dashed" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="badge badge-insufficient">EXPERIMENTAL</span>
        <strong style={{ fontSize: 13 }}>Shadow rules versus {s.benchmark.ruleVersion} (h = {h})</strong>
      </div>
      <div className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 8px", lineHeight: 1.5 }}>
        Candidate rules captured beside the production benchmark on the same sessions. They do not change any label on this site.
        Benchmark: {s.benchmark.cohort}. Differences are variant minus benchmark (95% intervals in brackets). {s.note}
      </div>
      <div className="scroll-x">
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr className="text-muted">
              <th style={td}>Rule</th>
              <th style={td}>Sessions</th>
              <th style={td}>Signals / session (benchmark)</th>
              <th style={td}>Adverse % (benchmark)</th>
              <th style={td}>Confirmed % (benchmark)</th>
              <th style={td}>Mean X (benchmark)</th>
              <th style={td}>Net 20 bps</th>
              <th style={td}>Δ adverse h1</th>
              <th style={td}>Δ adverse h5</th>
              <th style={td}>Δ mean X h10</th>
            </tr>
          </thead>
          <tbody>
            {s.variants.map((v) => {
              const x = v.horizons[k];
              return (
                <tr key={v.versionId} title={`${v.versionId}: ${v.definition}`}>
                  <td style={td}>
                    <strong>{NAMES[v.variant] ?? v.variant}</strong>
                  </td>
                  <td className="num" style={td}>
                    {v.sessions.eligible}
                    <span className="text-faint" style={{ fontSize: 10.5 }}>
                      {" "}
                      (checkpoint {v.checkpoint.reached ?? 0}
                      {v.checkpoint.next ? ` → ${v.checkpoint.next}` : ""})
                    </span>
                  </td>
                  <td className="num" style={td}>
                    {f(v.signalsPerSession)} ({f(v.mv1SignalsPerSession)})
                  </td>
                  <td className="num" style={td}>
                    {f(x?.variant.adverse)} ({f(x?.mv1.adverse)})
                  </td>
                  <td className="num" style={td}>
                    {f(x?.variant.confirmed)} ({f(x?.mv1.confirmed)})
                  </td>
                  <td className="num" style={td}>
                    {sg(x?.variant.meanX, 2)} ({sg(x?.mv1.meanX, 2)})
                  </td>
                  <td className="num" style={td}>
                    {sg(x?.variant.netT["20bps"], 2)}
                  </td>
                  <td className="num" style={td}>{ci(v.primary.P1)}</td>
                  <td className="num" style={td}>{ci(v.primary.P2)}</td>
                  <td className="num" style={td}>{ci(v.primary.P3, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
