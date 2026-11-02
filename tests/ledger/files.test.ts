import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanPartials, createOnly, listFiles, readJsonIfExists, replaceAtomic } from "../../scripts/ledger/files.mts";
import { tmpDir } from "./fixture.ts";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => {
  tmp = await tmpDir();
});
afterAll(async () => tmp.cleanup());

describe("create-only writes", () => {
  it("creates once and never overwrites", async () => {
    const f = path.join(tmp.dir, "a", "x.json");
    expect(await createOnly(f, '{"a":1}')).toEqual({ created: true });
    expect(await createOnly(f, '{"a":1}')).toEqual({ created: false, existing: "identical" });
    expect(await createOnly(f, '{"a":2}')).toEqual({ created: false, existing: "different" });
    expect(await readFile(f, "utf-8")).toBe('{"a":1}');
    expect(await readdir(path.dirname(f))).toEqual(["x.json"]); // no partial left behind
  });
  it("rejects invalid JSON before touching the destination", async () => {
    const f = path.join(tmp.dir, "b", "y.json");
    await expect(createOnly(f, "{nope")).rejects.toThrow();
    await expect(readFile(f)).rejects.toThrow();
  });
  it("concurrent writers: exactly one wins", async () => {
    const f = path.join(tmp.dir, "c", "z.json");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => createOnly(f, JSON.stringify({ i }))));
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });
  it("interrupted writes leave only .partial files, which are cleaned and never counted", async () => {
    const d = path.join(tmp.dir, "d");
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "2026-01-01.json.1-ab.partial"), "{trunc");
    await writeFile(path.join(d, "2026-01-02.json"), "{}");
    expect(await listFiles(d)).toEqual(["2026-01-02.json"]);
    expect(await cleanPartials(d)).toHaveLength(1);
    expect(await readdir(d)).toEqual(["2026-01-02.json"]);
  });
  it("replaceAtomic replaces and readJsonIfExists handles absence", async () => {
    const f = path.join(tmp.dir, "e", "state.json");
    expect(await readJsonIfExists(f)).toBeNull();
    await replaceAtomic(f, '{"v":1}');
    await replaceAtomic(f, '{"v":2}');
    expect(await readJsonIfExists(f)).toEqual({ v: 2 });
    await expect(replaceAtomic(f, "bad")).rejects.toThrow();
  });
});
