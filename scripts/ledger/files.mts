/** Create-only, atomic file creation. A file that exists is never overwritten. */
import { constants as fsc } from "node:fs";
import { link, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type CreateResult = { created: true } | { created: false; existing: "identical" | "different" };

/**
 * Writes `content` to `target` only if `target` does not exist.
 * 1. content is validated as JSON (when `requireJson`) before anything touches the destination;
 * 2. written to a unique `*.partial` file in the same directory and fsync-ed;
 * 3. published with hard-link(2), which fails with EEXIST instead of replacing - atomic and race-free;
 * 4. the partial file is always removed.
 */
export async function createOnly(target: string, content: string, opts: { requireJson?: boolean } = {}): Promise<CreateResult> {
  if (opts.requireJson !== false) JSON.parse(content);
  await mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}-${randomBytes(4).toString("hex")}.partial`;
  const fh = await open(partial, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o644);
  try {
    await fh.writeFile(content, "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await link(partial, target);
    return { created: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = await readFile(target, "utf-8");
      return { created: false, existing: existing === content ? "identical" : "different" };
    }
    throw err;
  } finally {
    await unlink(partial).catch(() => undefined);
  }
}

/** Atomic replace for the MUTABLE bookkeeping file only (ledger-state.json). Never used for ledger records. */
export async function replaceAtomic(target: string, content: string): Promise<void> {
  JSON.parse(content);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}-${randomBytes(4).toString("hex")}.partial`;
  const fh = await open(tmp, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o644);
  try {
    await fh.writeFile(content, "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, target);
}

/** Removes leftover `*.partial` files (interrupted runs) under `dir`. Returns the removed paths. */
export async function cleanPartials(dir: string): Promise<string[]> {
  const removed: string[] = [];
  async function walk(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".partial")) {
        await unlink(p);
        removed.push(p);
      }
    }
  }
  await walk(dir);
  return removed;
}

export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function listFiles(dir: string, suffix = ".json"): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(suffix)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
