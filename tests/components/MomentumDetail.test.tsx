// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { prepareUniverse, comparableBarsUpTo } from "../../src/lib/momentum/universe";
import { discover } from "../../src/lib/momentum/discovery";
import { filingsForSession } from "../../src/lib/momentum/news";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays } from "../momentum/fixtures";

// lightweight-charts needs a real canvas; the chart is not what these tests are about.
vi.mock("../../src/components/LineChart", () => ({ LineChart: ({ ariaLabel }: { ariaLabel: string }) => <div aria-label={ariaLabel} /> }));
const { MomentumDetailPanel } = await import("../../src/components/MomentumDetailPanel");

afterEach(() => cleanup());

const d = weekdays("2026-06-01", 80);
const bench = barsFrom(d, flatCloses(80, 1000, 0.002));
const bars = barsFrom(d.slice(0, 79), flatCloses(79, 100));
const p = bars[78].close;
bars.push({ date: d[79], open: p, high: p * 1.07, low: p * 0.999, close: p * 1.065 });
const ds = buildDataset(bench, [{ symbol: "ALPHA", bars }]);
const u = prepareUniverse(ds, { ALPHA: activityFor(d) });
const c = discover(u, d[79], DEFAULT_SETTINGS, "sideways").gainers[0];
const stock = u.bySymbol.get("ALPHA")!;

function renderPanel() {
  return render(
    <MomentumDetailPanel
      candidate={c}
      bars={comparableBarsUpTo(stock, stock.indexByDate.get(d[79])!)}
      activityByDate={stock.activityByDate}
      filings={filingsForSession(null, "ALPHA", d[79], d[78], null, new Date("2026-10-28T00:00:00Z"))}
      history={null}
      historyRan={false}
      onClose={() => {}}
    />,
  );
}

describe("stock detail: component scores", () => {
  it("renders one row per dimension plus the net row, each with its full explanation as a cell (no inner scroll container)", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "Component scores" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(c.assessment.components.length + 1);
    c.assessment.components.forEach((comp, i) => {
      const cells = within(rows[i]).getAllByRole("cell");
      expect(cells).toHaveLength(2);
      const expected = comp.score === null ? "inputs unavailable" : comp.reasons.length > 0 ? comp.reasons.join("; ") : "no rule triggered";
      expect(cells[1].textContent).toBe(expected);
      expect(cells[1].className).toContain("score-reasons");
    });
    expect(within(rows[rows.length - 1]).getByText(/An evidence tally, not a probability\./)).toBeTruthy();
    expect(table.closest(".scroll-x")).toBeNull();
  });

  it("states that history is not a forecast and that catalysts are unavailable when filings did not load", () => {
    renderPanel();
    expect(screen.getByText(/Filings data could not be loaded - catalyst information is unavailable/)).toBeTruthy();
    expect(screen.getByText(/Historical next-session evidence: not yet computed/)).toBeTruthy();
  });

  it("has the phone-width rule that moves each explanation beneath its score", () => {
    const css = readFileSync(path.resolve(__dirname, "../../src/styles/global.css"), "utf-8");
    const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(mobile).toMatch(/\.score-reasons\s*\{\s*grid-column:\s*1 \/ -1;/);
  });
});
