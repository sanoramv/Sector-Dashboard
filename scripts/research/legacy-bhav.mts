/**
 * Research-only (B6): converts NSE's older daily equity archives into the `sec_bhavdata_full` layout used everywhere
 * else, so the validated ingest and studies run unchanged on 2016-2020.
 *
 *  - bhav:  content/historical/EQUITIES/YYYY/MON/cmDDMONYYYYbhav.csv.zip  (SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,
 *           PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN)
 *  - mto:   archives/equities/mto/MTO_DDMMYYYY.DAT  (record type 20: sr, symbol, series, traded qty, deliverable qty, %)
 *
 * Pure functions here; the downloader is fetch-history-legacy.mts. Values are copied as published; derived fields:
 * AVG_PRICE = TOTTRDVAL / TOTTRDQTY, TURNOVER_LACS = TOTTRDVAL / 1e5 (both 2 decimals), DELIV_* from the MTO file
 * ("-" when the security has no MTO row, as NSE publishes for non-delivery series).
 */
import { inflateRawSync } from "node:zlib";

/** Minimal single-member ZIP reader (central directory; stored or deflate). Throws on anything unexpected. */
export function unzipSingle(buf: Buffer): { name: string; data: Buffer } {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip (no end of central directory)");
  const entries = buf.readUInt16LE(eocd + 10);
  if (entries !== 1) throw new Error(`zip has ${entries} entries, expected 1`);
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("bad central directory");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const usize = buf.readUInt32LE(cd + 24);
  const nlen = buf.readUInt16LE(cd + 28);
  const name = buf.subarray(cd + 46, cd + 46 + nlen).toString("utf-8");
  const lh = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("bad local header");
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const raw = buf.subarray(start, start + csize);
  const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`zip method ${method} unsupported`); })();
  if (data.length !== usize) throw new Error(`zip size mismatch ${data.length} vs ${usize}`);
  if (/[\\/]|\.\./.test(name)) throw new Error(`unexpected member name ${name}`);
  return { name, data };
}

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const legacyBhavPath = (iso: string) => `content/historical/EQUITIES/${iso.slice(0, 4)}/${MON[Number(iso.slice(5, 7)) - 1]}/cm${iso.slice(8, 10)}${MON[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4)}bhav.csv.zip`;
export const mtoPath = (iso: string) => `archives/equities/mto/MTO_${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}.DAT`;
const date1 = (iso: string) => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1][0]}${MON[Number(iso.slice(5, 7)) - 1].slice(1).toLowerCase()}-${iso.slice(0, 4)}`;

export interface MtoRow {
  qty: number;
  deliv: number;
  pct: string;
}
/** MTO record type 20 rows keyed by SYMBOL|SERIES; also returns the trade date stated in the header. */
export function parseMto(text: string): { tradeDate: string | null; rows: Map<string, MtoRow> } {
  const rows = new Map<string, MtoRow>();
  let tradeDate: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/Trade Date <(\d{2})-([A-Z]{3})-(\d{4})>/);
    if (m) tradeDate = `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1]}`;
    const c = line.split(",").map((x) => x.trim());
    if (c[0] !== "20" || c.length < 7) continue;
    rows.set(`${c[2]}|${c[3]}`, { qty: Number(c[4]), deliv: Number(c[5]), pct: c[6] });
  }
  return { tradeDate, rows };
}

export const SEC_HEADER = "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER";
const f2 = (x: number) => x.toFixed(2);

/**
 * Converts one legacy bhav file (+ optional MTO) for `iso` into sec_bhavdata_full text. Fails closed: the bhav TIMESTAMP
 * must be the requested date on every row, and the MTO trade date (when given) too.
 */
export function convertLegacy(iso: string, bhavCsv: string, mtoText: string | null): { text: string; rows: number; withDelivery: number } {
  const lines = bhavCsv.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(",").map((x) => x.trim());
  const ix = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`legacy bhav: missing column ${n}`);
    return i;
  };
  const I = { sym: ix("SYMBOL"), ser: ix("SERIES"), o: ix("OPEN"), h: ix("HIGH"), l: ix("LOW"), c: ix("CLOSE"), last: ix("LAST"), prev: ix("PREVCLOSE"), q: ix("TOTTRDQTY"), v: ix("TOTTRDVAL"), ts: ix("TIMESTAMP"), tr: ix("TOTALTRADES") };
  const mto = mtoText ? parseMto(mtoText) : null;
  if (mto && mto.tradeDate !== iso) throw new Error(`MTO trade date ${mto.tradeDate} is not ${iso}`);
  const want = date1(iso).toUpperCase();
  const out = [SEC_HEADER];
  let withDelivery = 0;
  for (const l of lines.slice(1)) {
    const c = l.split(",").map((x) => x.trim());
    if (c[I.ts].toUpperCase() !== want) throw new Error(`legacy bhav row for ${c[I.ts]}, expected ${want}`);
    const q = Number(c[I.q]);
    const v = Number(c[I.v]);
    const d = mto?.rows.get(`${c[I.sym]}|${c[I.ser]}`);
    if (d) withDelivery++;
    out.push([c[I.sym], c[I.ser], date1(iso), f2(Number(c[I.prev])), f2(Number(c[I.o])), f2(Number(c[I.h])), f2(Number(c[I.l])), f2(Number(c[I.last])), f2(Number(c[I.c])), q > 0 ? f2(v / q) : "0.00", String(q), f2(v / 1e5), c[I.tr], d ? String(d.deliv) : "-", d ? f2(Number(d.pct)) : "-"].join(", "));
  }
  return { text: out.join("\n") + "\n", rows: out.length - 1, withDelivery };
}
