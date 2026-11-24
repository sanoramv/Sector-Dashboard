/**
 * Outcome store: a directory of create-only OD1 outcome records, `od1/<rule version>/<date>/h<h>.json` (in production
 * `data/outcomes/` of this repository, committed by the data-update workflow).
 *
 * Guarantees:
 *  - records are create-only: an identical retry (same outcomesSha256, any time) is `existing` and returns the STORED
 *    record; different outcomes for an existing key are a `conflict`; nothing is ever overwritten or deleted;
 *  - every record is validated (structure, provenance, re-derivation) before it is written and when it is read;
 *  - corrections are append-only: a sequenced correction chained by outcomesSha256 plus a separately stored
 *    replacement record; the ORIGINAL stays the authoritative record; nothing is applied automatically;
 *  - logical keys are strictly validated, paths are resolved under the real root and symbolic links are refused;
 *  - writes are atomic (fsync-ed partial file published by hard link, which never replaces); leftover partial files
 *    of an interrupted run are removed when the store is opened.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalize } from "./canonical.mts";
import { cleanPartials, createOnly } from "./files.mts";
import { createOnlyDecision, validateCorrectionChain, validateOutcomeCorrection, validateOutcomeRecord, type OutcomeCorrection, type OutcomeRecord } from "./outcomes.mts";
import { listTree, realRoot, safeResolve } from "./safe-path.mts";

export type PutResult = { result: "created" | "existing"; stored: OutcomeRecord } | { result: "conflict"; stored: OutcomeRecord | null; detail: string };

export interface StoredCorrection {
  correction: OutcomeCorrection;
  replacement: OutcomeRecord;
}

export interface OutcomeStore {
  /** the authoritative (ORIGINAL) record, or null */
  getRecord(key: string): Promise<OutcomeRecord | null>;
  putRecord(record: OutcomeRecord): Promise<PutResult>;
  listKeys(): Promise<string[]>;
  getCorrections(key: string): Promise<StoredCorrection[]>;
  appendCorrection(key: string, c: StoredCorrection): Promise<"created" | "existing">;
}

const KEY = /^od1\/(mv\d+-[0-9a-f]{8})\/(\d{4}-\d{2}-\d{2})\/h(1|2|5|10)$/;
const isRealDate = (d: string) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Parses and validates a logical key `od1/<rule version>/<date>/h<horizon>`. */
export function parseStorageKey(key: string): { ruleVersion: string; sessionDate: string; horizon: number } {
  const m = typeof key === "string" ? key.match(KEY) : null;
  if (!m || !isRealDate(m[2])) throw new Error(`invalid outcome storage key ${JSON.stringify(key)}`);
  return { ruleVersion: m[1], sessionDate: m[2], horizon: Number(m[3]) };
}
const keyOf = (r: OutcomeRecord) => `od1/${r.header.ruleVersion}/${r.header.sessionDate}/h${r.header.horizon}`;

/** Stored form: canonical key order, compact (deterministic bytes for identical content). */
export const storedText = (value: unknown) => JSON.stringify(canonicalize(value)) + "\n";

export class FsOutcomeStore implements OutcomeStore {
  private constructor(
    readonly root: string,
    private readonly definitionsSha256: string,
    readonly recovered: string[],
  ) {}

  /** Opens (and recovers) a store. The root must exist and be a real directory (no symbolic link anywhere). */
  static async open(root: string, opts: { definitionsSha256: string }): Promise<FsOutcomeStore> {
    if (!path.isAbsolute(root)) throw new Error("outcome store root must be an absolute path");
    const real = await realRoot(root);
    await listTree(real); // refuses links and special files anywhere before anything is touched
    const recovered = await cleanPartials(real);
    return new FsOutcomeStore(real, opts.definitionsSha256, recovered);
  }

  private async read(rel: string): Promise<unknown | null> {
    const file = await safeResolve(this.root, rel);
    try {
      return JSON.parse(await readFile(file, "utf-8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`outcome store: ${rel} is unreadable or not JSON (${String(err).slice(0, 80)}); it is left untouched`);
    }
  }

  private checked(rel: string, o: unknown): OutcomeRecord {
    const p = validateOutcomeRecord(o, { definitionsSha256: this.definitionsSha256 });
    if (p.length) throw new Error(`outcome store: ${rel} is not a valid outcome record (${p.slice(0, 3).join("; ")}); it is left untouched`);
    return o as OutcomeRecord;
  }

  async getRecord(key: string): Promise<OutcomeRecord | null> {
    parseStorageKey(key);
    const o = await this.read(`${key}.json`);
    return o === null ? null : this.checked(`${key}.json`, o);
  }

  async putRecord(record: OutcomeRecord): Promise<PutResult> {
    const key = keyOf(record);
    parseStorageKey(key);
    this.checked(key, record);
    const rel = `${key}.json`;
    const file = await safeResolve(this.root, rel, { create: true });
    const res = await createOnly(file, storedText(record));
    if (res.created) return { result: "created", stored: record };
    const existing = this.checked(rel, await this.read(rel));
    if (res.existing === "identical" || createOnlyDecision(existing, record) === "existing") return { result: "existing", stored: existing };
    return { result: "conflict", stored: existing, detail: `${key}: a different outcome record is already stored; nothing was overwritten` };
  }

  async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    for (const f of await listTree(this.root)) {
      if (f.endsWith(".partial")) continue; // an in-flight write of a concurrent run (interrupted ones are removed on open)
      const m = f.match(/^(od1\/[^/]+\/[^/]+\/h\d+)(\.json|\.correction-\d+\.json|\.replacement-\d+\.json)$/);
      if (!m) throw new Error(`outcome store: unexpected file ${f} (fail closed)`);
      parseStorageKey(m[1]);
      if (m[2] === ".json") keys.push(m[1]);
    }
    return keys.sort();
  }

  async getCorrections(key: string): Promise<StoredCorrection[]> {
    const { ruleVersion, sessionDate, horizon } = parseStorageKey(key);
    const dir = `od1/${ruleVersion}/${sessionDate}`;
    const out: StoredCorrection[] = [];
    const ns = (await listTree(this.root, dir).catch(() => [] as string[]))
      .map((f) => f.match(new RegExp(`/h${horizon}\\.correction-(\\d+)\\.json$`)))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    for (const n of ns) {
      const correction = (await this.read(`${key}.correction-${n}.json`)) as OutcomeCorrection;
      const replacement = this.checked(`${key}.replacement-${n}.json`, await this.read(`${key}.replacement-${n}.json`));
      out.push({ correction, replacement });
    }
    return out;
  }

  /**
   * Appends correction n = (existing count + 1) to a stored record. Owner-initiated only (the outcome pipeline never
   * calls this). The replacement is written first and the correction last, so an interrupted append leaves at most an
   * orphan replacement, which an identical retry completes and a different retry reports as a conflict.
   */
  async appendCorrection(key: string, c: StoredCorrection): Promise<"created" | "existing"> {
    const original = await this.getRecord(key);
    if (!original) throw new Error(`${key}: there is no original record to correct`);
    const existing = await this.getCorrections(key);
    const done = existing.find((e) => e.correction.sequence === c.correction.sequence);
    if (done) {
      if (storedText(done.correction) === storedText(c.correction) && storedText(done.replacement) === storedText(c.replacement)) return "existing";
      throw new Error(`${key}: correction ${c.correction.sequence} already exists with different content (append-only; nothing overwritten)`);
    }
    const problems = validateOutcomeCorrection(c.correction);
    const id = parseStorageKey(key);
    const r = this.checked(`${key} replacement`, c.replacement);
    if (r.header.sessionDate !== id.sessionDate || r.header.ruleVersion !== id.ruleVersion || r.header.horizon !== id.horizon) problems.push("the replacement record is for a different session, rule version or horizon");
    if (c.correction.replacement !== r.header.outcomesSha256) problems.push("the correction's replacement hash does not match the replacement record");
    const head = existing.length ? existing[existing.length - 1].replacement : original;
    if (r.header.outcomesSha256 === head.header.outcomesSha256) problems.push("the replacement has the same outcomes as the record it supersedes");
    problems.push(...validateCorrectionChain({ ...id, outcomesSha256: original.header.outcomesSha256 }, [...existing.map((e) => e.correction), c.correction]));
    if (problems.length) throw new Error(`${key}: correction refused: ${problems.join("; ")}`);
    const rep = await createOnly(await safeResolve(this.root, `${key}.replacement-${c.correction.sequence}.json`, { create: true }), storedText(c.replacement));
    if (!rep.created && rep.existing !== "identical") throw new Error(`${key}: an orphan replacement ${c.correction.sequence} with different content exists (interrupted earlier attempt); owner review needed, nothing overwritten`);
    const cor = await createOnly(await safeResolve(this.root, `${key}.correction-${c.correction.sequence}.json`, { create: true }), storedText(c.correction));
    if (!cor.created && cor.existing !== "identical") throw new Error(`${key}: correction ${c.correction.sequence} was created concurrently with different content`);
    return rep.created || cor.created ? "created" : "existing";
  }
}
