import { useState } from "react";
import type { AppSettings } from "../types/config";
import { DEFAULT_SETTINGS } from "../types/config";

export interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  onClearCache: () => void;
}

export function SettingsPanel({ settings, onSave, onClose, onClearCache }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [confirmingClear, setConfirmingClear] = useState(false);

  function save() {
    onSave(draft);
    onClose();
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Settings">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottom: "1px solid var(--color-border)" }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Settings</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 18 }}>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            These thresholds control the strength-score conditions and the bullish/sideways/bearish classification
            rules. Changes apply immediately to already-fetched data - no re-fetch is needed. They are a screening
            heuristic, not a validated model; adjust them to match how you personally want to define "strong" or
            "weak" breadth.
          </p>

          <Field
            label="Breadth bullish threshold (%)"
            help="A sector's % above 20/50/200-DMA must exceed this value to count as a passing breadth condition in the strength score."
            value={draft.scoring.breadthBullishThresholdPct}
            onChange={(v) => setDraft((d) => ({ ...d, scoring: { ...d.scoring, breadthBullishThresholdPct: v } }))}
            min={0}
            max={100}
          />

          <Field
            label="Near 52-week-high threshold (%)"
            help="A sector scores a point when it is within this percentage of its 52-week high."
            value={draft.scoring.near52wHighThresholdPct}
            onChange={(v) => setDraft((d) => ({ ...d, scoring: { ...d.scoring, near52wHighThresholdPct: v } }))}
            min={0}
            max={50}
          />

          <Field
            label="Relative-performance score weight (points)"
            help="How many of the 9 total score points a positive 3M relative performance vs NIFTY 500 is worth."
            value={draft.scoring.relativePerformancePoints}
            onChange={(v) => setDraft((d) => ({ ...d, scoring: { ...d.scoring, relativePerformancePoints: v } }))}
            min={1}
            max={4}
          />

          <Field
            label="Regime breadth threshold (%)"
            help="The % above a moving average that counts as 'above' vs 'below' when classifying bullish/bearish regimes."
            value={draft.regime.breadthThresholdPct}
            onChange={(v) => setDraft((d) => ({ ...d, regime: { ...d.regime, breadthThresholdPct: v } }))}
            min={0}
            max={100}
          />

          <Field
            label="Minimum breadth measures required"
            help="How many of the 3 breadth measures (20/50/200-DMA) must be available to attempt a bullish/bearish classification at all. Below this, the sector is marked 'insufficient data' instead of guessed."
            value={draft.regime.minBreadthMeasuresRequired}
            onChange={(v) => setDraft((d) => ({ ...d, regime: { ...d.regime, minBreadthMeasuresRequired: v } }))}
            min={1}
            max={3}
          />

          <Field
            label="Minimum stocks per industry"
            help="Industries with fewer constituent stocks than this are forced to 'Insufficient data' rather than averaging over too small a sample."
            value={draft.industry.minConstituentsForAggregate}
            onChange={(v) => setDraft((d) => ({ ...d, industry: { ...d.industry, minConstituentsForAggregate: v } }))}
            min={1}
            max={10}
          />

          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Advanced: stock-screening pattern thresholds
            </summary>
            <div style={{ display: "grid", gap: 16, marginTop: 10 }}>
              <Field
                label="Resistance lookback (sessions)"
                help="How many trading sessions back to search for the nearest prior swing high used as a resistance level."
                value={draft.screening.resistanceLookbackSessions}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, resistanceLookbackSessions: v } }))}
                min={10}
                max={250}
              />
              <Field
                label="Resistance proximity (%)"
                help="A stock is flagged 'approaching resistance' when below the level by no more than this percentage."
                value={draft.screening.resistanceProximityPct}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, resistanceProximityPct: v } }))}
                min={0.5}
                max={15}
              />
              <Field
                label="Consolidation recent window (sessions)"
                help="The short recent window whose average daily range is compared against the baseline window."
                value={draft.screening.consolidationLookbackSessions}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, consolidationLookbackSessions: v } }))}
                min={5}
                max={60}
              />
              <Field
                label="Consolidation baseline window (sessions)"
                help="The longer baseline window used as the 'normal' range for comparison."
                value={draft.screening.consolidationBaselineSessions}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, consolidationBaselineSessions: v } }))}
                min={20}
                max={250}
              />
              <Field
                label="Consolidation contraction ratio"
                help="Recent range must be below this fraction of the baseline range to count as consolidating (e.g. 0.6 = recent range is less than 60% of baseline)."
                value={draft.screening.consolidationContractionRatio}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, consolidationContractionRatio: v } }))}
                min={0.1}
                max={1}
              />
              <Field
                label="Triangle lookback (sessions)"
                help="Trailing window searched for swing-high/swing-low pivots used to fit the triangle trendlines."
                value={draft.screening.triangleLookbackSessions}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, triangleLookbackSessions: v } }))}
                min={15}
                max={120}
              />
              <Field
                label="Triangle pivot spacing (sessions)"
                help="Minimum bars on each side of a candidate pivot for it to count as a local swing high/low."
                value={draft.screening.trianglePivotSpacing}
                onChange={(v) => setDraft((d) => ({ ...d, screening: { ...d.screening, trianglePivotSpacing: v } }))}
                min={1}
                max={10}
              />
            </div>
          </details>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => setDraft(DEFAULT_SETTINGS)}>
              Reset to defaults
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              Save settings
            </button>
          </div>

          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Local data</h3>
            {!confirmingClear ? (
              <button type="button" className="btn" onClick={() => setConfirmingClear(true)}>
                Clear cached data
              </button>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="text-muted" style={{ fontSize: 13 }}>
                  This removes the locally cached snapshot. You'll need to refresh to fetch data again. Continue?
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onClearCache();
                    setConfirmingClear(false);
                    onClose();
                  }}
                >
                  Yes, clear it
                </button>
                <button type="button" className="btn" onClick={() => setConfirmingClear(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div className="text-faint" style={{ fontSize: 11.5, marginBottom: 6 }}>
        {help}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          width: 120,
        }}
      />
    </label>
  );
}
