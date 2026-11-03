// Pure, dependency-free watchdog logic (design §13). It only DECIDES which GitHub Issues should exist; it cannot
// change any file. Plain JavaScript so the privileged workflow needs no `npm ci`.
//
// Inputs come from ledger-state.json (written by the capture job): per-date status, the pipeline's own exchange-calendar
// classification of each date, and metrics. Holidays are therefore never guessed here.

const DAY_MS = 86_400_000;
export const REVIEW_FLAG_DAYS = 7;
const IST_OFFSET_MS = 330 * 60_000;

/** 09:00 IST of a calendar date (epoch ms). Mirrors scripts/ledger/calendar.mts (a parity test enforces this). */
export function cutoffAt(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 9, 0) - IST_OFFSET_MS;
}
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const isWeekend = (date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/** Earliest possible cut-off: 09:00 IST on the first following weekday. */
export function earliestCutoffMs(date) {
  let d = addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return cutoffAt(d);
}

export const TITLES = {
  missing: (date) => `Ledger snapshot missing: ${date}`,
  review: (kind, date) => `Ledger review (${kind}): ${date}`,
  capacity: (metric) => `Ledger capacity: ${metric}`,
  stale: () => "Ledger capture is stale",
};

/**
 * @param {{now: Date, state: any, thresholds?: any}} input
 * @returns {{wanted: {key:string,title:string,body:string,labels:string[],autoClose:boolean}[], resolvable: string[]}}
 */
export function evaluate({ now, state, thresholds = {} }) {
  const wanted = [];
  const resolvable = [];
  const nowMs = now.getTime();
  const dates = state?.dates ?? {};
  const calendar = state?.calendar ?? {};
  const enabledFrom = state?.enabledFrom ?? null;
  // A capture can only be MISSING once a rule version has been enabled, and only from the enabled date onwards. A never-enabled
  // ledger (enabledFrom null, missing or not a real calendar date) owes no capture for any date, so no missing-capture alert may be raised for it.
  const isRealDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value; // rejects 2026-02-30 and 2026-13-45
  };
  const enabled = isRealDate(enabledFrom);
  if (!state) {
    return { wanted: [{ key: "state-missing", title: TITLES.stale(), body: "ledger-state.json could not be read from main.", labels: ["ledger"], autoClose: true }], resolvable };
  }

  const considered = new Set([...Object.keys(dates), ...Object.keys(calendar).filter((d) => calendar[d] === "trading")]);
  for (const date of [...considered].sort()) {
    if (enabled && date < enabledFrom) continue;
    if (calendar[date] && calendar[date] !== "trading" && !dates[date]) continue; // exchange holiday or unresolved: never a ledger alert
    const rec = dates[date];
    const earliest = rec?.earliestCutoffUtc ? Date.parse(rec.earliestCutoffUtc) : earliestCutoffMs(date);
    const cutoff = rec?.cutoffUtc ? Date.parse(rec.cutoffUtc) : earliest;
    const live = rec && rec.publicationClass === "live";
    const status = rec?.status ?? "absent";

    if (status === "anomaly") wanted.push({ key: `anomaly:${date}`, title: TITLES.review("anomaly", date), body: `Capture status is anomaly for ${date}.\n\n${(rec.reasons ?? []).join("\n")}`, labels: ["ledger", "ledger-review"], autoClose: false });
    if (status === "source-revised") wanted.push({ key: `source-revised:${date}`, title: TITLES.review("source-revised", date), body: `Source data for ${date} changed after capture.\n\n${(rec.reasons ?? []).join("\n")}`, labels: ["ledger", "ledger-review"], autoClose: false });
    // R11 review flag: advisory. The issue stays open for REVIEW_FLAG_DAYS after the session so it can be looked at,
    // then closes itself. The flag itself stays in the daily record and in ledger-state.json permanently.
    if (status === "review-required" && nowMs - Date.parse(`${date}T00:00:00Z`) > REVIEW_FLAG_DAYS * DAY_MS) resolvable.push(`review:${date}`);
    else if (status === "review-required") wanted.push({ key: `review:${date}`, title: TITLES.review("price-break burst", date), body: `A review flag was raised for ${date}. The capture was recorded.\n\n${(rec.reasons ?? []).join("\n")}`, labels: ["ledger", "ledger-review"], autoClose: true });
    if ((status === "unverified" || rec?.publicationClass === "unverified") && nowMs - Date.parse(`${date}T00:00:00Z`) > DAY_MS) wanted.push({ key: `unverified:${date}`, title: TITLES.review("unverified publication", date), body: `Publication time for ${date} could not be verified; it is excluded from the live holdout.\n\n${(rec.reasons ?? []).join("\n")}`, labels: ["ledger", "ledger-review"], autoClose: false });

    if (live) {
      resolvable.push(`missing:${date}`);
      continue;
    }
    const capturedAtAll = ["recorded", "recorded-late", "review-required", "unverified", "source-revised"].includes(status);
    if (!enabled) {
      // Never enabled: nothing is owed. (Review / anomaly / source-revision / unverified checks above still apply to any record that exists.)
      if (capturedAtAll) resolvable.push(`missing:${date}`);
      continue;
    }
    if (nowMs > cutoff) {
      // The cut-off has passed and there is no live capture: the live opportunity for this session is gone.
      if (!capturedAtAll) {
        const reasons = (rec?.reasons ?? []).join("\n") || "No capture was recorded.";
        wanted.push({ key: `missing:${date}`, title: TITLES.missing(date), body: `The cut-off for ${date} (${new Date(cutoff).toISOString()}) passed without a live capture.\nStatus: ${status}.\n\n${reasons}\n\nThis session cannot count toward the live holdout. It is closed automatically as a recorded loss when the next capture settles it.`, labels: ["ledger", "ledger-lost-session"], autoClose: false });
      }
    } else if (nowMs > earliest - 15 * 60_000 && !capturedAtAll) {
      wanted.push({ key: `missing:${date}`, title: TITLES.missing(date), body: `${date} has no capture yet and the earliest cut-off is ${new Date(earliest).toISOString()}.\nStatus: ${status}.\n\n${(rec?.reasons ?? []).join("\n")}`, labels: ["ledger"], autoClose: true });
    } else if (capturedAtAll) resolvable.push(`missing:${date}`);
  }

  // The capture job itself must be alive on trading days.
  const updated = Date.parse(state.updatedAt ?? "");
  const staleHours = thresholds.staleHours ?? 36;
  if (Number.isFinite(updated) && nowMs - updated > staleHours * 3_600_000 && !isWeekend(now.toISOString().slice(0, 10))) {
    wanted.push({ key: "stale", title: TITLES.stale(), body: `ledger-state.json was last updated ${state.updatedAt}, more than ${staleHours} hours ago.`, labels: ["ledger"], autoClose: true });
  } else resolvable.push("stale");

  // Capacity triggers (design §17.3).
  const m = state.metrics ?? {};
  const t = { publicDataBytes: 500e6, ledgerBytes: 600e6, dailyFileBytes: 5e6, captureSeconds: 300, ...(thresholds.capacity ?? {}) };
  for (const [metric, limit] of Object.entries(t)) {
    if (typeof m[metric] === "number" && m[metric] > limit) wanted.push({ key: `capacity:${metric}`, title: TITLES.capacity(metric), body: `${metric} = ${m[metric]} exceeds the review trigger ${limit}. See the design document section 17.3 for the response ladder.`, labels: ["ledger", "ledger-capacity"], autoClose: false });
    else resolvable.push(`capacity:${metric}`);
  }
  return { wanted, resolvable };
}

const MARKER = /<!-- ledger-watchdog:([0-9a-f]+) -->/;
export const withMarker = (body, hash) => `${body}\n\n<!-- ledger-watchdog:${hash} -->`;
export const markerOf = (body) => (typeof body === "string" ? (body.match(MARKER)?.[1] ?? null) : null);

/**
 * Decides which GitHub Issue actions are needed. An issue that already exists is only commented on / updated when the
 * wanted content actually changed (its stored content hash differs); unchanged issues produce no notification.
 * @param {{wanted: {key:string,title:string,body:string,labels:string[],autoClose:boolean}[], resolvable: string[], open: {number:number,title:string,body?:string}[], hash: (s:string)=>string, titleOf: (key:string)=>string|null}} input
 */
export function planIssueActions({ wanted, resolvable, open, hash, titleOf }) {
  const byTitle = new Map(open.map((i) => [i.title, i]));
  const actions = [];
  for (const w of wanted) {
    const h = hash(w.body);
    const existing = byTitle.get(w.title);
    if (!existing) actions.push({ type: "create", title: w.title, body: withMarker(w.body, h), labels: w.labels });
    else if (markerOf(existing.body) !== h) actions.push({ type: "update", number: existing.number, title: w.title, body: withMarker(w.body, h), comment: `Changed since the last check:\n\n${w.body}` });
  }
  const wantedTitles = new Set(wanted.map((w) => w.title));
  for (const key of resolvable) {
    const title = titleOf(key);
    const existing = title ? byTitle.get(title) : null;
    if (existing && !wantedTitles.has(title)) actions.push({ type: "close", number: existing.number, title, comment: "Recorded in ledger-state.json: no longer outstanding. Closing." });
  }
  return actions;
}
