import type { DataStatus } from "../lib/providers/types";
import type { RefreshStatus } from "../types/dataset";
import { formatDateHuman, formatDateTimeHuman, formatRelativeToNow } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export interface HeaderProps {
  providerName: string;
  latestMarketDate: string | null;
  lastSuccessfulFetchAt: string | null;
  /** The pipeline's own verdict on its last run (from manifest.json); undefined for older manifests. */
  refresh?: RefreshStatus;
  status: DataStatus | "unavailable";
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

export function Header({
  providerName,
  latestMarketDate,
  lastSuccessfulFetchAt,
  refresh,
  status,
  isRefreshing,
  onRefresh,
  onOpenSettings,
  onOpenHelp,
}: HeaderProps) {
  return (
    <header className="card" style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}>
      <div
        className="container"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingBlock: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 17, margin: 0, fontWeight: 800 }}>NSE Sector Strength Dashboard</h1>
          <p className="text-muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            Research &amp; screening tool for NSE sector trend, breadth and relative strength. Not an automated
            trading system.
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, fontSize: 12.5 }}>
          <div>
            <div className="text-faint">Data provider</div>
            <div title={providerName} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
              {providerName}
            </div>
          </div>
          <div>
            <div className="text-faint">Latest market data</div>
            <div className="num">{formatDateHuman(latestMarketDate)}</div>
          </div>
          {refresh && (
            <div>
              <div className="text-faint">Pipeline refresh</div>
              <div
                className={refresh.outcome === "complete" ? "" : refresh.outcome === "partial" ? "text-muted" : "text-neg"}
                title={
                  `Last pipeline run: ${formatDateTimeHuman(refresh.evaluatedAt)} (${refresh.outcome}).` +
                  `\nLast complete refresh: ${refresh.lastCompleteRefreshAt ? formatDateTimeHuman(refresh.lastCompleteRefreshAt) : "never"}.` +
                  (refresh.reasons.length > 0 ? `\n${refresh.reasons.join("\n")}` : "")
                }
              >
                {refresh.outcome === "complete"
                  ? `Complete · ${formatRelativeToNow(refresh.evaluatedAt)}`
                  : `${refresh.outcome === "failed" ? "Failed" : "Partial"} · last complete ${formatRelativeToNow(refresh.lastCompleteRefreshAt)}`}
              </div>
            </div>
          )}
          <div>
            <div className="text-faint">Loaded in browser</div>
            <div
              className="num"
              title={`When this browser last downloaded the published data files: ${formatDateTimeHuman(lastSuccessfulFetchAt)}. This is not when NSE data was last retrieved - see Pipeline refresh.`}
            >
              {formatRelativeToNow(lastSuccessfulFetchAt)}
            </div>
          </div>
          <div>
            <div className="text-faint">Status</div>
            <StatusBadge status={status} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing…" : "Refresh Data"}
            </button>
            <button type="button" className="btn" onClick={onOpenHelp} aria-label="Open metric glossary and help">
              Help
            </button>
            <button type="button" className="btn" onClick={onOpenSettings} aria-label="Open settings">
              Settings
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
