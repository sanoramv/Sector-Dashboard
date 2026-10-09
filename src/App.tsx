import { useMemo, useState } from "react";
import { useMarketData } from "./hooks/useMarketData";
import { Header } from "./components/Header";
import { MarketOverview } from "./components/MarketOverview";
import { SectorTable } from "./components/SectorTable";
import { SectorDetailPanel } from "./components/SectorDetailPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { HelpModal } from "./components/HelpModal";
import { UNAVAILABLE_SECTORS } from "./config/sectorUniverse";
import { sectorsToCsv, downloadCsv } from "./lib/export/csv";
import { downloadJson } from "./lib/export/json";
import { computeRegimeHistory } from "./lib/dashboard";

export default function App() {
  const market = useMarketData();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const selectedSector = useMemo(
    () => market.dashboardData?.sectors.find((s) => s.slug === selectedSlug) ?? null,
    [market.dashboardData, selectedSlug],
  );

  const regimeHistory = useMemo(() => {
    if (!selectedSlug || !market.rawDataset) return [];
    return computeRegimeHistory(selectedSlug, market.rawDataset, market.settings);
  }, [selectedSlug, market.rawDataset, market.settings]);

  function handleExportCsv() {
    if (!market.dashboardData) return;
    downloadCsv(`nse-sector-dashboard-${market.dashboardData.latestMarketDate}.csv`, sectorsToCsv(market.dashboardData.sectors));
  }

  function handleExportJson() {
    if (!market.dashboardData) return;
    downloadJson(`nse-sector-dashboard-${market.dashboardData.latestMarketDate}.json`, market.dashboardData);
  }

  return (
    <div>
      <Header
        providerName={market.providerName}
        latestMarketDate={market.dashboardData?.latestMarketDate ?? null}
        lastSuccessfulFetchAt={market.lastSuccessfulFetchAt}
        status={market.status}
        isRefreshing={market.isRefreshing}
        onRefresh={market.refresh}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <main className="container" style={{ paddingBlock: 20 }}>
        {market.error && (
          <div className="card badge-insufficient" style={{ padding: 12, marginBottom: 16, borderRadius: 8 }}>
            <strong>Refresh failed:</strong> {market.error}{" "}
            {market.dashboardData
              ? "Showing the last valid cached snapshot instead."
              : "No cached data is available to fall back on."}
          </div>
        )}

        {!market.error && market.warnings.length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: "var(--color-insufficient-bg)" }}>
            <strong>Data quality warnings:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {market.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {market.status === "cached" && !market.isRefreshing && (
          <div className="card" style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: "var(--color-sideways-bg)" }}>
            Showing a cached snapshot from local storage, not freshly fetched data. Click <strong>Refresh Data</strong>{" "}
            to try fetching the latest published data.
          </div>
        )}

        {!market.dashboardData && !market.isRefreshing && (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <p>No data available yet.</p>
            <button type="button" className="btn btn-primary" onClick={market.refresh}>
              Refresh Data
            </button>
          </div>
        )}

        {!market.dashboardData && market.isRefreshing && (
          <div className="card" style={{ padding: 24, textAlign: "center" }} aria-live="polite">
            Fetching market data…
          </div>
        )}

        {market.dashboardData && (
          <>
            <MarketOverview overview={market.dashboardData.overview} />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 10 }}>
              <button type="button" className="btn" onClick={handleExportCsv}>
                Export CSV
              </button>
              <button type="button" className="btn" onClick={handleExportJson}>
                Export JSON
              </button>
            </div>

            <SectorTable sectors={market.dashboardData.sectors} onSelect={setSelectedSlug} />

            <div className="card" style={{ padding: 14, marginTop: 16, fontSize: 12.5 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowUnavailable((v) => !v)}
                aria-expanded={showUnavailable}
              >
                {showUnavailable ? "Hide" : "Show"} sectors not currently tracked ({UNAVAILABLE_SECTORS.length})
              </button>
              {showUnavailable && (
                <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                  {UNAVAILABLE_SECTORS.map((s) => (
                    <li key={s.slug} style={{ marginBottom: 4 }}>
                      <strong>{s.displayName}</strong> — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>

      {selectedSector && market.dashboardData && (
        <SectorDetailPanel sector={selectedSector} regimeHistory={regimeHistory} onClose={() => setSelectedSlug(null)} />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={market.settings}
          onSave={market.updateSettings}
          onClose={() => setSettingsOpen(false)}
          onClearCache={market.clearCache}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
