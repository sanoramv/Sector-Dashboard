import { useEffect, useRef } from "react";
import { createChart, AreaSeries, LineSeries, type IChartApi } from "lightweight-charts";

export interface ChartPoint {
  time: string; // ISO date "yyyy-mm-dd"
  value: number;
}

export interface LineChartProps {
  data: ChartPoint[];
  height?: number;
  kind?: "area" | "line";
  color?: string;
  ariaLabel: string;
}

const isDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function LineChart({ data, height = 220, kind = "area", color, ariaLabel }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dark = isDark();
    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: dark ? "#a0a8b3" : "#5b6472",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: dark ? "#2a3039" : "#eceef1" },
        horzLines: { color: dark ? "#2a3039" : "#eceef1" },
      },
      timeScale: { borderColor: dark ? "#2a3039" : "#dde1e6" },
      rightPriceScale: { borderColor: dark ? "#2a3039" : "#dde1e6" },
    });
    chartRef.current = chart;

    const lineColor = color ?? (dark ? "#6a9bff" : "#1a56db");
    const series =
      kind === "area"
        ? chart.addSeries(AreaSeries, {
            lineColor,
            topColor: `${lineColor}33`,
            bottomColor: `${lineColor}00`,
            lineWidth: 2,
          })
        : chart.addSeries(LineSeries, { color: lineColor, lineWidth: 2 });

    series.setData(data.map((d) => ({ time: d.time, value: d.value })) as never);
    chart.timeScale().fitContent();

    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height, kind, color]);

  if (data.length === 0) {
    return (
      <div className="text-muted" style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        No chart data available.
      </div>
    );
  }

  return <div ref={containerRef} role="img" aria-label={ariaLabel} style={{ width: "100%", height }} />;
}
