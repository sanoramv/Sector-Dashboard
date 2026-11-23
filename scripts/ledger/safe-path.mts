/**
 * Path safety for protected and public outcome storage (Phase B2a). Every file the outcome pipeline reads or creates is
 * addressed by a RELATIVE logical path under a fixed, real (symlink-resolved) root. Absolute paths, `..`, `.`, empty
 * segments, backslashes, NUL and symbolic links anywhere below the root are refused; directories are created one level
 * at a time and re-checked, so a planted link can never redirect a write or a read outside the root.
 */
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export class UnsafePathError extends Error {}

/** Validates a relative logical path and returns its segments. */
export function relativeSegments(rel: string): string[] {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 512) throw new UnsafePathError("the path must be a non-empty relative path");
  if (rel.includes("\0") || rel.includes("\\")) throw new UnsafePathError(`unsafe character in path ${JSON.stringify(rel)}`);
  if (rel.startsWith("/") || path.isAbsolute(rel)) throw new UnsafePathError(`absolute paths are refused: ${rel}`);
  const segs = rel.split("/");
  for (const s of segs) if (s === "" || s === "." || s === "..") throw new UnsafePathError(`path traversal or empty segment refused: ${rel}`);
  return segs;
}

/** The symlink-free real path of an existing directory root (the root itself must not be a symbolic link). */
export async function realRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new UnsafePathError("the storage root must be absolute");
  const st = await lstat(root);
  if (st.isSymbolicLink()) throw new UnsafePathError(`the storage root ${root} is a symbolic link`);
  if (!st.isDirectory()) throw new UnsafePathError(`the storage root ${root} is not a directory`);
  return realpath(root);
}

async function lstatOrNull(p: string) {
  try {
    return await lstat(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Resolves `rel` under `root` (already real). Each parent directory must be a real directory (never a link); with
 * `create` missing parents are created one at a time. The final entry may be absent; if present it must be a regular
 * file. Returns the absolute path.
 */
export async function safeResolve(root: string, rel: string, opts: { create?: boolean } = {}): Promise<string> {
  const segs = relativeSegments(rel);
  let cur = root;
  for (const s of segs.slice(0, -1)) {
    cur = path.join(cur, s);
    let st = await lstatOrNull(cur);
    if (!st && opts.create) {
      await mkdir(cur).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
      st = await lstatOrNull(cur);
    }
    if (!st) return path.join(root, ...segs); // nothing below exists yet (read-only resolution)
    if (st.isSymbolicLink()) throw new UnsafePathError(`symbolic link refused in storage path: ${path.relative(root, cur)}`);
    if (!st.isDirectory()) throw new UnsafePathError(`not a directory in storage path: ${path.relative(root, cur)}`);
  }
  const full = path.join(root, ...segs);
  if (!(full === root || full.startsWith(root + path.sep))) throw new UnsafePathError(`path escapes the storage root: ${rel}`);
  const st = await lstatOrNull(full);
  if (st && st.isSymbolicLink()) throw new UnsafePathError(`symbolic link refused: ${rel}`);
  if (st && !st.isFile()) throw new UnsafePathError(`not a regular file: ${rel}`);
  return full;
}

/** Every regular file below `dir` as a relative `/` path. Any symbolic link or special file is an error (fail closed). */
export async function listTree(root: string, dir = ""): Promise<string[]> {
  const abs = dir ? path.join(root, ...relativeSegments(dir)) : root;
  const st = await lstatOrNull(abs);
  if (!st) return [];
  if (st.isSymbolicLink()) throw new UnsafePathError(`symbolic link refused: ${dir}`);
  if (!st.isDirectory()) throw new UnsafePathError(`not a directory: ${dir}`);
  const out: string[] = [];
  for (const e of await readdir(abs, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new UnsafePathError(`symbolic link refused: ${rel}`);
    if (e.isDirectory()) out.push(...(await listTree(root, rel)));
    else if (e.isFile()) out.push(rel);
    else throw new UnsafePathError(`special file refused: ${rel}`);
  }
  return out.sort();
}
