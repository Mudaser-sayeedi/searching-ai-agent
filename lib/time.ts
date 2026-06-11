import type { TimeRange } from "./types";

export interface ResolvedRange {
  /** Inclusive lower bound (start of day), or null for "any time". */
  from: Date | null;
  /** Inclusive upper bound (end of day), or null for open-ended. */
  to: Date | null;
  /** Human-readable description injected into the model prompt. */
  label: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

/** Turn a user-selected TimeRange into concrete date bounds + a prompt label. */
export function resolveTimeRange(range: TimeRange): ResolvedRange {
  const now = new Date();
  const today = startOfDay(now);

  switch (range.preset) {
    case "today":
      return { from: today, to: endOfDay(now), label: `today (${fmt(today)})` };
    case "yesterday": {
      const y = addDays(today, -1);
      return {
        from: y,
        to: endOfDay(y),
        label: `yesterday (${fmt(y)})`,
      };
    }
    case "week":
      return {
        from: addDays(today, -7),
        to: endOfDay(now),
        label: `the past 7 days (since ${fmt(addDays(today, -7))})`,
      };
    case "month":
      return {
        from: addDays(today, -30),
        to: endOfDay(now),
        label: `the past 30 days (since ${fmt(addDays(today, -30))})`,
      };
    case "year":
      return {
        from: addDays(today, -365),
        to: endOfDay(now),
        label: `the past 12 months (since ${fmt(addDays(today, -365))})`,
      };
    case "custom": {
      const from = range.from ? startOfDay(new Date(range.from)) : null;
      const to = range.to ? endOfDay(new Date(range.to)) : endOfDay(now);
      const label =
        from && to
          ? `between ${fmt(from)} and ${fmt(to)}`
          : from
            ? `since ${fmt(from)}`
            : "any time";
      return { from, to, label };
    }
    case "any":
    default:
      return { from: null, to: null, label: "any time" };
  }
}

/**
 * Best-effort check that a model-reported publish date falls within bounds.
 * Returns true when the date is unparseable (we don't have enough info to reject).
 */
export function dateWithinRange(
  publishedAt: string | undefined,
  range: ResolvedRange,
): boolean {
  if (!range.from && !range.to) return true;
  if (!publishedAt) return true; // unknown date: don't reject, rely on the prompt
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return true;
  const d = new Date(t);
  // Allow a small grace margin around the bounds for fuzzy "published" dates.
  if (range.from && d.getTime() < range.from.getTime() - 86_400_000) return false;
  if (range.to && d.getTime() > range.to.getTime() + 86_400_000) return false;
  return true;
}
