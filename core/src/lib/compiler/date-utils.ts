/**
 * Date/datetime parameter resolution.
 *
 * A `date` / `datetime` parameter's value (default or provided) may be a relative
 * expression resolved at COMPILE TIME — so each run uses the current date:
 *   now            today  (alias)
 *   now-7d         7 days ago        now+1d
 *   now-1w         1 week ago        now+2weeks
 *   now-3m / -3mo  3 months ago      now+1month
 *   now-1y         1 year ago        now+1year
 *   now+2h         2 hours from now  (datetime)
 *   now-30min      30 minutes ago
 *   now-15s        15 seconds ago
 * or an ISO / Date-parseable literal (e.g. "2026-06-10", "2026-06-10T09:00").
 *
 * Output: `date` -> "YYYY-MM-DD", `datetime` -> "YYYY-MM-DDTHH:mm:ss" (local time).
 * A value that isn't a recognized date expression is returned unchanged so type
 * validation can flag it.
 */

/** Parse a relative date expression or a literal into a Date, or null. */
export function parseDateExpr(input: string): Date | null {
  const v = (input ?? '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();

  if (lower === 'now' || lower === 'today') return new Date();

  const rel = lower.match(/^(?:now|today)\s*([+-])\s*(\d+)\s*([a-z]+)$/);
  if (rel) {
    const n = (rel[1] === '-' ? -1 : 1) * parseInt(rel[2], 10);
    const u = rel[3];
    const d = new Date();
    if (u === 'd' || u.startsWith('day')) d.setDate(d.getDate() + n);
    else if (u === 'w' || u.startsWith('week')) d.setDate(d.getDate() + n * 7);
    else if (u === 'min' || u.startsWith('minute')) d.setMinutes(d.getMinutes() + n);
    else if (u === 'mo' || u === 'm' || u.startsWith('month')) d.setMonth(d.getMonth() + n);
    else if (u === 'y' || u.startsWith('year')) d.setFullYear(d.getFullYear() + n);
    else if (u === 'h' || u.startsWith('hour')) d.setHours(d.getHours() + n);
    else if (u === 's' || u === 'sec' || u.startsWith('second')) d.setSeconds(d.getSeconds() + n);
    else return null; // unknown unit
    return d;
  }

  // Date-only literal: parse as LOCAL midnight. `new Date("2026-01-15")` would
  // parse as UTC, which shifts the day in negative-offset timezones.
  const dateOnly = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const parsed = new Date(v);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local "YYYY-MM-DD". */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local "YYYY-MM-DDTHH:mm:ss". */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Resolve a date/datetime value to its formatted string; non-strings and
 * unrecognized expressions pass through unchanged. */
export function resolveDateValue(value: unknown, withTime: boolean): unknown {
  if (typeof value !== 'string') return value;
  const d = parseDateExpr(value);
  if (!d) return value;
  return withTime ? formatDateTime(d) : formatDate(d);
}
