import type { DataStatus } from "../lib/providers/types";
import { formatDateHuman, formatDateTimeHuman, formatRelativeToNow } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export interface HeaderProps {
  providerName: string;
  latestMarketDate: string | null;
  lastSuccessfulFetchAt: string | null;
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
          <div>
            <div className="text-faint">Last fetched</div>
            <div className="num" title={formatDateTimeHuman(lastSuccessfulFetchAt)}>
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
