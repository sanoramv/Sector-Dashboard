import { useMemo, useState } from "react";
import { useMarketData } from "./hooks/useMarketData";
import { Header } from "./components/Header";
import { MarketOverview } from "./components/MarketOverview";
import { SectorTable } from "./components/SectorTable";
import { SectorDetailPanel } from "./components/SectorDetailPanel";
import { IndustryTable } from "./components/IndustryTable";
import { IndustryDetailPanel } from "./components/IndustryDetailPanel";
import { StockScreenerTable } from "./components/StockScreenerTable";
import { StockDetailPanel } from "./components/StockDetailPanel";
import { BacktestPanel } from "./components/BacktestPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { Tabs } from "./components/Tabs";
import { SettingsPanel } from "./components/SettingsPanel";
import { HelpModal } from "./components/HelpModal";
import { UNAVAILABLE_SECTORS } from "./config/sectorUniverse";
import { sectorsToCsv, stocksToCsv, downloadCsv } from "./lib/export/csv";
import { downloadJson } from "./lib/export/json";
import { computeRegimeHistory } from "./lib/dashboard";

type TabKey = "sectors" | "industries" | "screener" | "backtest" | "history";

export default function App() {
  const market = useMarketData();
  const [activeTab, setActiveTab] = useState<TabKey>("sectors");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedIndustrySlug, setSelectedIndustrySlug] = useState<string | null>(null);
  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const selectedSector = useMemo(
    () => market.dashboardData?.sectors.find((s) => s.slug === selectedSlug) ?? null,
    [market.dashboardData, selectedSlug],
  );

  const selectedIndustry = useMemo(
    () => market.dashboardData?.industries.find((i) => i.slug === selectedIndustrySlug) ?? null,
    [market.dashboardData, selectedIndustrySlug],
  );

  const selectedStock = useMemo(
    () => market.dashboardData?.stockScreen.find((s) => s.symbol === selectedStockSymbol) ?? null,
    [market.dashboardData, selectedStockSymbol],
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

  function handleExportStocksCsv() {
    if (!market.dashboardData) return;
    downloadCsv(`nse-stock-screen-${market.dashboardData.latestMarketDate}.csv`, stocksToCsv(market.dashboardData.stockScreen));
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

            <Tabs
              tabs={[
                { key: "sectors", label: "Sectors" },
                { key: "industries", label: `Industries (${market.dashboardData.industries.length})` },
                { key: "screener", label: `Stock Screener (${market.dashboardData.stockScreen.length})` },
                { key: "backtest", label: "Backtest" },
                { key: "history", label: `History (${market.snapshotHistory.length})` },
              ]}
              active={activeTab}
              onChange={(k) => setActiveTab(k as TabKey)}
            />

            {activeTab === "sectors" && (
              <>
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
                          <strong>{s.displayName}</strong> — {s.reason}. Its industry equivalent may still be viewable
                          under the Industries tab, computed from real constituent stocks.
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {activeTab === "industries" && (
              <IndustryTable industries={market.dashboardData.industries} onSelect={setSelectedIndustrySlug} />
            )}

            {activeTab === "screener" && (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                  <button type="button" className="btn" onClick={handleExportStocksCsv}>
                    Export CSV
                  </button>
                </div>
                <StockScreenerTable
                  stocks={market.dashboardData.stockScreen}
                  sectors={market.dashboardData.sectors}
                  industries={market.dashboardData.industries}
                  onSelect={setSelectedStockSymbol}
                />
              </>
            )}

            {activeTab === "backtest" && market.rawDataset && (
              <BacktestPanel rawDataset={market.rawDataset} settings={market.settings} />
            )}

            {activeTab === "history" && (
              <HistoryPanel
                history={market.snapshotHistory}
                onExportJson={() => downloadJson(`nse-sector-dashboard-history.json`, { entries: market.snapshotHistory })}
              />
            )}
          </>
        )}
      </main>

      {selectedSector && market.dashboardData && (
        <SectorDetailPanel sector={selectedSector} regimeHistory={regimeHistory} onClose={() => setSelectedSlug(null)} />
      )}

      {selectedIndustry && (
        <IndustryDetailPanel industry={selectedIndustry} onClose={() => setSelectedIndustrySlug(null)} />
      )}

      {selectedStock && <StockDetailPanel stock={selectedStock} onClose={() => setSelectedStockSymbol(null)} />}

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
