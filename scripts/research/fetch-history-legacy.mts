/**
 * Research-only (B6): downloads NSE's older equity archives (legacy bhav zip + MTO delivery file) and stores each date
 * CONVERTED to the sec_bhavdata_full layout (legacy-bhav.mts) under research-data/nse/stock/<YYYY>/<date>.csv.gz, in the
 * same manifest as fetch-history.mts (kind "stock", source "legacy"). Index files keep using fetch-history.mts
 * (--kinds index), whose format exists from 2014.
 *
 *   npx tsx scripts/research/fetch-history-legacy.mts --from 2016-01-01 --to 2020-10-30 [--out research-data/nse]
 *   npx tsx scripts/research/fetch-history-legacy.mts --dates 2016-10-30,2019-10-27
 *
 * Resumable and safe to stop: a date whose stock entry is "ok" or "missing" is skipped; files are written atomically
 * (.partial + rename) and the manifest entry is appended only after the rename; leftover .partial files are removed on
 * start; an unrecorded file is deleted and fetched again. A 404 bhav is "missing" (holiday). A bhav whose TIMESTAMP is not
 * the requested date, or an MTO for another date, is an error (never stored). A missing MTO stores the day without
 * delivery ("-"), flagged `mto: "missing"`.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { requestHeaders } from "../lib/http.mts";
import { convertLegacy, legacyBhavPath, mtoPath, unzipSingle } from "./legacy-bhav.mts";

const BASE = "https://nsearchives.nseindia.com/";
/** Weekdays from..to inclusive (same rule as fetch-history.mts, which cannot be imported: it runs on import). */
function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

async function get(rel: string): Promise<{ status: number; body: Buffer | null }> {
  const res = await fetch(BASE + rel, { headers: { ...requestHeaders(), Accept: "*/*" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, d?: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
  const out = path.resolve(opt("--out", "research-data/nse")!);
  if (out.split(path.sep).includes("public")) throw new Error("research data must never be written under public/");
  const explicit = opt("--dates")?.split(",").filter(Boolean) ?? null;
  const from = opt("--from");
  const to = opt("--to");
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (explicit ? !explicit.every((d) => ISO.test(d)) : !ISO.test(from ?? "") || !ISO.test(to ?? "")) throw new Error("use --from/--to YYYY-MM-DD or --dates a,b");
  const manifest = path.join(out, "manifest.jsonl");
  await mkdir(out, { recursive: true });
  const seen = new Set<string>();
  try {
    for (const l of (await readFile(manifest, "utf-8")).split("\n").filter(Boolean)) {
      const e = JSON.parse(l);
      if (e.kind === "stock" && (e.status === "ok" || e.status === "missing")) seen.add(e.date);
    }
  } catch {
    /* new manifest */
  }
  const stockDir = path.join(out, "stock");
  for (const y of await readdir(stockDir).catch(() => [] as string[])) for (const f of await readdir(path.join(stockDir, y)).catch(() => [] as string[])) if (f.endsWith(".partial")) await rm(path.join(stockDir, y, f));
  let ok = 0;
  let missing = 0;
  let failed = 0;
  for (const date of explicit ?? weekdaysBetween(from!, to!)) {
    if (seen.has(date)) continue;
    const file = path.join(stockDir, date.slice(0, 4), `${date}.csv.gz`);
    if (await stat(file).then(() => true, () => false)) await rm(file); // unrecorded: never trusted
    let entry: Record<string, unknown> = { kind: "stock", date, at: new Date().toISOString(), source: "legacy" };
    try {
      const bhav = await get(legacyBhavPath(date));
      await sleep(1200);
      if (bhav.status === 404) {
        entry = { ...entry, status: "missing", http: 404 };
        missing++;
      } else if (!bhav.body) {
        entry = { ...entry, status: "error", http: bhav.status };
        failed++;
      } else {
        const csv = unzipSingle(bhav.body).data.toString("utf-8");
        const mto = await get(mtoPath(date));
        await sleep(1200);
        const conv = convertLegacy(date, csv, mto.body ? mto.body.toString("utf-8") : null);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.partial`, gzipSync(conv.text));
        await rename(`${file}.partial`, file);
        entry = { ...entry, status: "ok", bytes: Buffer.byteLength(conv.text), sha256: sha(conv.text), rows: conv.rows, withDelivery: conv.withDelivery, bhavSha256: sha(bhav.body), mto: mto.body ? "ok" : `missing (${mto.status})`, ...(mto.body ? { mtoSha256: sha(mto.body) } : {}) };
        ok++;
      }
    } catch (err) {
      entry = { ...entry, status: "error", reason: String(err).slice(0, 160) };
      failed++;
    }
    await appendFile(manifest, JSON.stringify(entry) + "\n");
  }
  console.log(`legacy history ${explicit ? explicit.join(",") : `${from}..${to}`}: ok ${ok}, missing ${missing}, failed ${failed} -> ${out}`);
}

main().catch((err) => {
  console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
