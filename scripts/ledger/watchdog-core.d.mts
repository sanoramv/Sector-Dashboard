export interface WantedIssue {
  key: string;
  title: string;
  body: string;
  labels: string[];
  autoClose: boolean;
}
export function cutoffAt(date: string): number;
export function addDays(date: string, n: number): string;
export function isWeekend(date: string): boolean;
export function earliestCutoffMs(date: string): number;
export const TITLES: {
  missing: (date: string) => string;
  review: (kind: string, date: string) => string;
  capacity: (metric: string) => string;
  stale: () => string;
};
export function evaluate(input: { now: Date; state: any; thresholds?: any }): { wanted: WantedIssue[]; resolvable: string[] };
export type IssueAction = { type: "create"; title: string; body: string; labels: string[] } | { type: "update"; number: number; title: string; body: string; comment: string } | { type: "close"; number: number; title: string; comment: string };
export function withMarker(body: string, hash: string): string;
export function markerOf(body: string | undefined | null): string | null;
export function planIssueActions(input: { wanted: WantedIssue[]; resolvable: string[]; open: { number: number; title: string; body?: string }[]; hash: (s: string) => string; titleOf: (key: string) => string | null }): IssueAction[];
export const REVIEW_FLAG_DAYS: number;
