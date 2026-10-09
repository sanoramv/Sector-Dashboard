/** Formats a Date as DDMMYYYY, the filename-date format NSE's archives use. */
export function toDdMmYyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

/** Formats a Date as ISO (YYYY-MM-DD). */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parses NSE's "DD-MM-YYYY" date column format into ISO (YYYY-MM-DD). */
export function nseDateToIso(nseDate: string): string {
  const [dd, mm, yyyy] = nseDate.trim().split("-");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/** Parses NSE's "DD-Mon-YYYY" (e.g. "08-Oct-2025") bhavcopy date format into ISO. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function nseMonthNameDateToIso(nseDate: string): string {
  const [dd, mon, yyyy] = nseDate.trim().split("-");
  const mm = String(MONTHS.indexOf(mon) + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
}

/** Returns calendar dates (as Date objects, UTC midnight), newest first, from `daysBack` days ago through today, skipping Sat/Sun. */
export function weekdaysBack(daysBack: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < daysBack; i++) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}
