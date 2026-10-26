/**
 * Final gate of the "Update NSE sector data" workflow. Runs AFTER the
 * validated data has been committed, so whatever was retrieved is kept and
 * published - and then makes the job fail when a recent trading day is still
 * missing, so a green run always means the published data is current.
 *   outcome "failed"  -> exit 1 (recent trading day missing / unresolved)
 *   outcome "partial" -> exit 0 with a warning (older gaps or backfill remaining)
 *   outcome "complete" -> exit 0
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "../src/types/dataset.ts";

export function refreshExitCode(manifest: Pick<Manifest, "refresh">): { code: 0 | 1; lines: string[] } {
  const r = manifest.refresh;
  if (!r) return { code: 1, lines: ["::error::manifest.json has no refresh status - build-manifest did not evaluate this run."] };
  const header = `Refresh ${r.outcome}: latest due ${r.latestDueDate}, ${r.tradingDaysBehind} trading day(s) behind, last complete refresh ${r.lastCompleteRefreshAt ?? "never"}.`;
  if (r.outcome === "failed") return { code: 1, lines: [`::error::${header}`, ...r.reasons.map((x) => `::error::${x}`)] };
  if (r.outcome === "partial") return { code: 0, lines: [`::warning::${header}`, ...r.reasons.map((x) => `::warning::${x}`)] };
  return { code: 0, lines: [header] };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const manifest: Manifest = JSON.parse(await readFile(path.resolve("public/data/manifest.json"), "utf-8"));
  const { code, lines } = refreshExitCode(manifest);
  lines.forEach((l) => console.log(l));
  process.exit(code);
}
