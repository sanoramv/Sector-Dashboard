/**
 * Research-only historical NSE archive download (Track C). Never touches public/data or production files.
 *
 *   npx tsx scripts/research/fetch-history.mts --from 2020-11-02 --to 2025-08-22 [--out research-data/nse] [--kinds stock,index]
 *
 * Official NSE archives (the same hosts the production pipeline uses):
 *  - stock: products/content/sec_bhavdata_full_DDMMYYYY.csv  (all series; OHLC, prev close, volume, turnover, delivery;
 *           available from late 2019)
 *  - index: content/indices/ind_close_all_DDMMYYYY.csv        (all NSE indices; available from at least 2014)
 * Files are stored gzipped under <out>/<kind>/<YYYY>/<date>.csv.gz with a JSONL manifest (status, bytes, sha256).
 * Resumable (files already present are skipped), paced at one request per ~1.2 s, weekdays only; a 404 is recorded as
 * "missing" (holiday or not published) and never retried in the same run. --out must be git-ignored.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { requestHeaders } from "../lib/http.mts";

const URLS: Record<string, (ddmmyyyy: string) => string> = {
  stock: (d) => `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${d}.csv`,
  index: (d) => `https://nsearchives.nseindia.com/content/indices/ind_close_all_${d}.csv`,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, dflt?: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : dflt);
  const from = opt("--from")!;
  const to = opt("--to")!;
  const out = path.resolve(opt("--out", "research-data/nse")!);
  const kinds = opt("--kinds", "stock,index")!.split(",");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) throw new Error("--from and --to must be YYYY-MM-DD");
  if (out.split(path.sep).includes("public")) throw new Error("research data must never be written under public/");
  const manifest = path.join(out, "manifest.jsonl");
  await mkdir(out, { recursive: true });
  const seen = new Set<string>();
  try {
    for (const l of (await readFile(manifest, "utf-8")).split("\n").filter(Boolean)) {
      const e = JSON.parse(l);
      if (e.status === "ok" || e.status === "missing") seen.add(`${e.kind}|${e.date}`);
    }
  } catch {
    /* new manifest */
  }
  let ok = 0;
  let missing = 0;
  let failed = 0;
  for (const date of weekdaysBetween(from, to)) {
    for (const kind of kinds) {
      if (seen.has(`${kind}|${date}`)) continue;
      const file = path.join(out, kind, date.slice(0, 4), `${date}.csv.gz`);
      if (await stat(file).then(() => true, () => false)) continue;
      let entry: Record<string, unknown> = { kind, date, at: new Date().toISOString() };
      try {
        const res = await fetch(URLS[kind](ddmmyyyy(date)), { headers: requestHeaders(), signal: AbortSignal.timeout(30_000) });
        if (res.status === 404) {
          entry = { ...entry, status: "missing", http: 404 };
          missing++;
        } else if (!res.ok) {
          entry = { ...entry, status: "error", http: res.status };
          failed++;
        } else {
          const buf = Buffer.from(await res.arrayBuffer());
          const text = buf.toString("utf-8");
          if (!/,/.test(text.split("\n")[0] ?? "") || text.length < 500) {
            entry = { ...entry, status: "error", reason: "not a CSV archive", bytes: buf.length };
            failed++;
          } else {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, gzipSync(buf));
            entry = { ...entry, status: "ok", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
            ok++;
          }
        }
      } catch (err) {
        entry = { ...entry, status: "error", reason: String(err).slice(0, 120) };
        failed++;
      }
      await appendFile(manifest, JSON.stringify(entry) + "\n");
      await sleep(1200);
    }
  }
  console.log(`research history ${from}..${to} (${kinds.join(",")}): ok ${ok}, missing ${missing}, failed ${failed} -> ${out}`);
}

main().catch((err) => {
  console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
