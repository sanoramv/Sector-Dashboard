// Alerts-only watchdog runner (design §13). Token scopes: contents:read, issues:write. It reads ledger-state.json from
// main through the contents API and manages GitHub Issues. It writes nothing to the repository.
import { createHash } from "node:crypto";
import { evaluate } from "./ledger/watchdog-core.mjs";

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token) {
  console.error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  process.exit(2);
}
const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init.headers ?? {}) },
  });

async function readState() {
  const res = await api("/contents/public/data/ledger/ledger-state.json?ref=main", { headers: { Accept: "application/vnd.github.raw+json" } });
  if (res.status === 404) return { missingFile: true };
  if (!res.ok) throw new Error(`contents API HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

const labelsNeeded = ["ledger", "ledger-review", "ledger-lost-session", "ledger-capacity"];
for (const name of labelsNeeded) {
  const r = await api("/labels", { method: "POST", body: JSON.stringify({ name, color: "b60205" }) });
  if (!r.ok && r.status !== 422) console.warn(`label ${name}: HTTP ${r.status}`);
}

const state = await readState();
if (state.missingFile) {
  console.log("ledger-state.json does not exist yet (capture has never run); nothing to alert on.");
  process.exit(0);
}
const { wanted, resolvable } = evaluate({ now: new Date(), state });

const open = [];
for (let page = 1; page < 6; page++) {
  const res = await api(`/issues?labels=ledger&state=open&per_page=100&page=${page}`);
  if (!res.ok) throw new Error(`issues API HTTP ${res.status}`);
  const items = (await res.json()).filter((i) => !i.pull_request);
  open.push(...items);
  if (items.length < 100) break;
}
const { TITLES, planIssueActions } = await import("./ledger/watchdog-core.mjs");
const titleOf = (key) => {
  const [kind, ...rest] = key.split(":");
  const arg = rest.join(":");
  if (kind === "missing") return TITLES.missing(arg);
  if (kind === "review") return TITLES.review("price-break burst", arg);
  if (kind === "capacity") return TITLES.capacity(arg);
  if (kind === "stale") return TITLES.stale();
  return null;
};
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Issues are only created, updated when their content changed, or closed. Unchanged issues cause no activity at all.
const actions = planIssueActions({ wanted, resolvable, open, hash, titleOf });
for (const a of actions) {
  if (a.type === "create") {
    const res = await api("/issues", { method: "POST", body: JSON.stringify({ title: a.title, body: a.body, labels: a.labels }) });
    console.log(res.ok ? `opened ${a.title}` : `could not open "${a.title}": HTTP ${res.status}`);
  } else if (a.type === "update") {
    await api(`/issues/${a.number}`, { method: "PATCH", body: JSON.stringify({ body: a.body }) });
    await api(`/issues/${a.number}/comments`, { method: "POST", body: JSON.stringify({ body: a.comment }) });
    console.log(`updated #${a.number} ${a.title}`);
  } else {
    await api(`/issues/${a.number}/comments`, { method: "POST", body: JSON.stringify({ body: a.comment }) });
    await api(`/issues/${a.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    console.log(`closed #${a.number} ${a.title}`);
  }
}
console.log(`watchdog finished: ${wanted.length} alert(s) wanted, ${actions.length} action(s) taken.`);
