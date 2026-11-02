import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { RULE_FILES } from "../../scripts/ledger/ruleVersion.mts";
import { ACTIVITY_QUERY, activityPath } from "../../scripts/ledger/receipt.mts";

const wf = (n: string) => readFile(`.github/workflows/${n}`, "utf-8");
const stepBlock = (y: string, name: string) => {
  const i = y.indexOf(`- name: ${name}`);
  expect(i, name).toBeGreaterThanOrEqual(0);
  const next = y.indexOf("\n      - ", i + 10);
  return y.slice(i, next === -1 ? undefined : next);
};
const pathsOf = (y: string, event: "push" | "pull_request") => {
  const m = y.match(new RegExp(`\\n  ${event}:\\n(?:    branches:[^\\n]*\\n)?    paths:\\n((?:      - [^\\n]+\\n)+)`));
  expect(m, event).not.toBeNull();
  return m![1].split("\n").filter(Boolean).map((l) => l.replace(/^\s+- "?|"?$/g, ""));
};

describe("update-data.yml (static; configured, not executed)", () => {
  it("keeps the original schedules and adds the three ledger slots", async () => {
    const y = await wf("update-data.yml");
    for (const c of ["30 14 * * 1-5", "30 2 * * 2-6", "0 16 * * 1-5", "30 17 * * 1-5", "0 19 * * 1-5"]) expect(y).toContain(`cron: "${c}"`);
  });
  it("orders the ledger steps after the manifest and before the data commit; the gate is last", async () => {
    const y = await wf("update-data.yml");
    const names = ["Build manifest", "Ledger capture", "Ledger receipts", "Remove interrupted ledger partial files", "Ledger pre-commit validation", "Ledger fail-safe restore", "Validate the pipeline output", "Commit updated data", "Fail if a recent trading day", "Ledger gate"];
    const at = names.map((n) => y.indexOf(`- name: ${n}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("capture, receipts and pre-commit are non-blocking; each has an id the gate reads", async () => {
    const y = await wf("update-data.yml");
    for (const [name, id] of [["Ledger capture", "ledger_capture"], ["Ledger receipts", "ledger_verify"], ["Ledger pre-commit validation", "ledger_precommit"]]) {
      const b = stepBlock(y, name);
      expect(b).toContain("continue-on-error: true");
      expect(b).toContain(`id: ${id}`);
    }
    const gate = y.slice(y.indexOf("- name: Ledger gate"));
    expect(gate).toContain("!cancelled()");
    for (const [env, id] of [["LEDGER_CAPTURE_OUTCOME", "ledger_capture"], ["LEDGER_VERIFY_OUTCOME", "ledger_verify"], ["LEDGER_PRECOMMIT_OUTCOME", "ledger_precommit"]]) expect(gate).toContain(`${env}: \${{ steps.${id}.outcome }}`);
  });
  it("only the receipt step receives a token; capture and pre-commit get none", async () => {
    const y = await wf("update-data.yml");
    expect(stepBlock(y, "Ledger capture")).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|github\.token/);
    expect(stepBlock(y, "Ledger pre-commit validation")).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|github\.token/);
    expect(stepBlock(y, "Ledger receipts")).toContain("GH_TOKEN: ${{ github.token }}");
  });
  it("the existing data steps are unchanged and no write permission was added", async () => {
    const y = await wf("update-data.yml");
    for (const s of ["npm run fetch:index-history", "npm run fetch:stocks", "npm run build:manifest", "run: npm run test", "npm run -s check:refresh", "bash scripts/ledger-stage-data.sh"]) expect(y).toContain(s);
    expect(await readFile("scripts/ledger-stage-data.sh", "utf-8")).toContain("git add public/data");
    expect(y).toContain("fetch-depth: 0");
    expect(y).toMatch(/permissions:\n  contents: write\n(?:  #[^\n]*\n)?  actions: read\n/);
    expect(y).not.toMatch(/issues: write|pull-requests: write|id-token|pages: write/);
  });
});

describe("other ledger workflows", () => {
  it("guard and governance are read-only", async () => {
    for (const n of ["ledger-guard.yml", "ledger-governance.yml"]) {
      const y = await wf(n);
      expect(y).toMatch(/permissions:\n  contents: read\n/);
      expect(y).not.toMatch(/: write/);
    }
    expect(await wf("ledger-guard.yml")).toContain("workflow_run");
  });
  it("governance path filters cover every rule file, protocol and holdout, ledger scripts and tests - and nothing unrelated", async () => {
    const y = await wf("ledger-governance.yml");
    const push = pathsOf(y, "push");
    expect(pathsOf(y, "pull_request")).toEqual(push);
    for (const f of RULE_FILES) expect(push, f).toContain(f);
    expect(push).not.toContain("vite.config.ts"); // no longer modified or relevant (F8)
    expect(push).toContain("package.json"); // the ledger scripts and the `test` script live there
    for (const f of ["public/data/ledger/protocol/**", "public/data/ledger/holdout.json", "scripts/ledger/**", "scripts/ledger-*", "tests/ledger/**", "vitest.ledger.config.ts"]) expect(push, f).toContain(f);
    // no broad directory wildcards over code that is not part of the rule path
    for (const p of push) expect(p, p).not.toMatch(/^src\/(lib\/calculations|config|types|lib\/momentum)\/\*\*$/);
    expect(push.filter((p) => p.startsWith("src/")).length).toBe(RULE_FILES.length + 1); // + src/lib/ledger/**
    expect(y).toContain("workflow_dispatch");
  });
  it("watchdog: minimum permissions, SHA-pinned actions, credentials not persisted, sparse checkout, no install, daily schedule", async () => {
    const y = await wf("ledger-watchdog.yml");
    expect(y).toMatch(/^permissions: \{\}/m);
    expect(y).toMatch(/permissions:\n      contents: read[^\n]*\n      issues: write/);
    expect(y).not.toMatch(/contents: write|npm ci|npm install|actions: write|pull-requests|id-token/);
    for (const m of y.matchAll(/uses: (\S+)/g)) expect(m[1], m[1]).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
    expect(y).toContain("persist-credentials: false");
    expect(y).toContain("sparse-checkout-cone-mode: false");
    expect(y).toMatch(/scripts\/ledger\/watchdog-core\.mjs\n\s+scripts\/ledger-watchdog\.mjs/);
    expect(y).toContain('cron: "15 3 * * *"');
    expect(y).toContain('cron: "30 19 * * *"');
  });
  it("the watchdog script's complete set of API paths is exactly this list (no prefix matching); behaviour is checked by the stubbed-fetch run in watchdog.test.ts", async () => {
    const src = await readFile("scripts/ledger-watchdog.mjs", "utf-8");
    const paths = [...src.matchAll(/api\(\s*([`"'])(.*?)\1/g)].map((m) => m[2]).sort();
    expect(paths).toEqual(["/contents/public/data/ledger/ledger-state.json?ref=main", "/issues", "/issues/${a.number}", "/issues/${a.number}", "/issues/${a.number}/comments", "/issues/${a.number}/comments", "/issues?labels=ledger&state=open&per_page=100&page=${page}", "/labels"].sort());
    expect(src).not.toMatch(/writeFile|appendFile|child_process|git push|"PUT"|"DELETE"/);
  });
  it("token probe: manual only, no checkout, no repository code, three separate permission jobs, no token printing", async () => {
    const y = await wf("ledger-token-probe.yml");
    expect(y).toMatch(/^on:\n  workflow_dispatch:\n/m);
    expect(y).not.toMatch(/\n  (push|pull_request|schedule|workflow_run):/);
    expect(y).not.toMatch(/uses:/);
    expect(y).not.toMatch(/npm |npx |tsx |ledger:|checkout/);
    expect(y).toMatch(/^permissions: \{\}/m);
    expect(y).toMatch(/probe-none:[\s\S]*?permissions: \{\}/);
    expect(y).toMatch(/probe-contents-read:[\s\S]*?permissions:\n      contents: read\n/);
    expect(y).toMatch(/probe-contents-read-actions-read:[\s\S]*?permissions:\n      contents: read\n      actions: read\n/);
    expect(y).not.toMatch(/: write/);
    expect(y).not.toMatch(/echo[^\n]*(GH_TOKEN|GITHUB_TOKEN)|print[^\n]*(GH_TOKEN|GITHUB_TOKEN)|cat headers|set -x/);
    expect(y).toContain("x-accepted-github-permissions");
    expect(y).toContain("x-ratelimit");
    // it calls EXACTLY the request the receipt code makes: same path, same query, per_page=100 included
    const url = y.match(/ACTIVITY_URL: ([^\n]+)/)![1];
    expect(url).toBe(`https://api.github.com${activityPath("${{ github.repository }}")}`);
    expect(ACTIVITY_QUERY).toBe("ref=refs/heads/main&activity_type=push&per_page=100");
    expect(url).toContain("per_page=100");
    // each of the three permission-level jobs receives the token through its OWN step env, and runs the shared validator
    for (const job of ["probe-none", "probe-contents-read", "probe-contents-read-actions-read"]) {
      const block = y.slice(y.indexOf(`  ${job}:`)).split(/\n  probe-[a-z-]+:/)[0];
      expect(block, job).toMatch(/env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n/);
      expect(block, job).toMatch(/PROBE_NAME: /);
      expect(block, job).toMatch(/run: node -e "\$PROBE_JS"/);
    }
    expect((y.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g) ?? []).length).toBe(3);
    expect((y.match(/run: node -e "\$PROBE_JS"/g) ?? []).length).toBe(3);
    // the JavaScript validator reads the token from GH_TOKEN and uses it only as the Authorization header
    const js = y.slice(y.indexOf("PROBE_JS: |"), y.indexOf("\njobs:"));
    expect(js).toContain("process.env.GH_TOKEN");
    expect(js).toContain('headers.Authorization = "Bearer " + token');
    expect((js.match(/\btoken\b/g) ?? []).length).toBeGreaterThan(0);
    // ... and never prints it: the only output that mentions the token is a yes/NO flag
    expect(js).not.toMatch(/(say|console\.(log|error|warn))\([^\n]*(\+\s*token\b|\btoken\s*\+|\$\{token\}|JSON\.stringify\(\s*(token|headers)|process\.env\.GH_TOKEN)/);
    expect(js).toContain('"token supplied: " + (token ? "yes (value never printed)" : "NO")');
    expect(js).not.toMatch(/appendFileSync\([^\n]*token/);
    expect(js).not.toMatch(/\bheaders\b[^\n]*(say|console)|(say|console\.\w+)\([^\n]*\bheaders\b(?!\.get)/);
    // a green job is not a pass: the validator exits 1 on FAIL and reports PASS / FAIL / INCONCLUSIVE explicitly
    expect(js).toContain('process.exit(verdict === "FAIL" ? 1 : 0)');
    for (const v of ["PASS", "FAIL", "INCONCLUSIVE"]) expect(js).toContain(`"${v}"`);
    // it validates the fields the receipt code reads, and looks for the push of this run's own commit
    for (const field of ["activity_type", "e.ref", "e.before", "e.after", "e.timestamp", "e.id"]) expect(js, field).toContain(field);
    expect(js).toContain("GITHUB_SHA");
  });
});

describe("workflow commands exist", () => {
  it("every `npm run <script>` used by any workflow is defined in package.json", async () => {
    const { readdir } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile("package.json", "utf-8"));
    for (const f of (await readdir(".github/workflows")).filter((n) => n.endsWith(".yml"))) {
      const y = await wf(f);
      for (const m of y.matchAll(/npm run (?:-s )?([a-z:-]+)/g)) expect(pkg.scripts[m[1]], `${f}: npm run ${m[1]}`).toBeDefined();
    }
  });
});

describe("test discovery", () => {
  it("npm test excludes only the ledger directory by CLI; vite.config.ts is unmodified and `npm run test:ledger` is separate", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf-8"));
    expect(pkg.scripts.test).toBe('vitest run --exclude "tests/ledger/**"');
    expect(pkg.scripts["test:ledger"]).toBe("vitest run --config vitest.ledger.config.ts");
    const vite = await readFile("vite.config.ts", "utf-8");
    expect(vite).not.toMatch(/exclude|ledger|configDefaults/);
    expect(await readFile("vitest.ledger.config.ts", "utf-8")).toMatch(/tests\/ledger\/\*\*\/\*\.test\.ts/);
  });
});
