import type { SectorMetrics } from "../../types/metrics";

function fmtPct(m: { available: true; value: number } | { available: false; reason: string }): string {
  return m.available ? m.value.toFixed(2) : "N/A";
}

const COLUMNS = [
  "Sector",
  "Current Close",
  "1D Return %",
  "1W Return %",
  "1M Return %",
  "3M Return %",
  "6M Return %",
  "% Above 20DMA",
  "% Above 50DMA",
  "% Above 200DMA",
  "Distance from 52W High %",
  "3M Relative Performance (pp)",
  "Strength Score",
  "Score Completeness %",
  "Regime",
  "Confidence",
  "Data Quality",
] as const;

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function sectorsToCsv(sectors: SectorMetrics[]): string {
  const rows = sectors.map((s) =>
    [
      s.displayName,
      s.currentClose.available ? s.currentClose.value.toFixed(2) : "N/A",
      fmtPct(s.returns.d1),
      fmtPct(s.returns.w1),
      fmtPct(s.returns.m1),
      fmtPct(s.returns.m3),
      fmtPct(s.returns.m6),
      fmtPct(s.breadth.above20dma.pct),
      fmtPct(s.breadth.above50dma.pct),
      fmtPct(s.breadth.above200dma.pct),
      fmtPct(s.distanceFrom52wHigh),
      fmtPct(s.relativeStrength.m3),
      String(s.score.pointsEarned),
      s.score.completenessPct.toFixed(0),
      s.regime.regime,
      s.regime.confidence,
      s.dataQuality.status,
    ]
      .map((v) => escapeCsvField(String(v)))
      .join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
