import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { tmpDir } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

describe("deployment path", () => {
  it("ledger files placed under public/data reach dist/data byte-for-byte with the Pages base path", async () => {
    const pub = path.join(tmp.dir, "public");
    const out = path.join(tmp.dir, "dist");
    const files: Record<string, string> = {
      "data/ledger/live/predictions/mv1-x/2026-10-29.json": JSON.stringify({ header: { sessionDate: "2026-10-29" }, predictions: [] }),
      "data/ledger/live/receipts/2026-10-29.json": '{"class":"live"}\n',
      "data/ledger/ledger-state.json": '{"kind":"momentum-ledger.state"}\n',
      "data/ledger/holdout.json": await readFile("public/data/ledger/holdout.json", "utf-8"),
    };
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(pub, rel)), { recursive: true });
      await writeFile(path.join(pub, rel), body);
    }
    await build({ root: path.resolve("."), base: "/Sector-Dashboard/", publicDir: pub, build: { outDir: out, emptyOutDir: true, write: true }, logLevel: "silent", configFile: path.resolve("vite.config.ts") });
    for (const [rel, body] of Object.entries(files)) expect(await readFile(path.join(out, rel), "utf-8")).toBe(body);
    expect(await readFile(path.join(out, "index.html"), "utf-8")).toContain("/Sector-Dashboard/");
  }, 120_000);
});
