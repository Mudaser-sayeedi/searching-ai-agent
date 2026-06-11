import { searchWeb } from "./gemini";
import { addLeads, getQueries } from "./store";
import { dateWithinRange, resolveTimeRange } from "./time";
import type { Lead, RunResult, TimeRange } from "./types";

// Orchestrates a full monitoring run: for every enabled query, search the web
// via Gemini within the requested recency window, then filter, dedupe, and
// persist the new leads.

/** Minimum confidence required to keep a candidate lead. */
const MIN_CONFIDENCE = 0.35;

// Safety net: even with prompt exclusions, occasionally a recruitment listing
// slips through. Drop anything whose text clearly reads as a job posting.
const JOB_POSTING_RE =
  /\b(hiring|job opening|vacanc|careers?|recruit|apply now|full[- ]time|part[- ]time|salary|we['’]?re looking for|now hiring|join our team)\b/i;

function looksLikeJobPosting(text: string): boolean {
  return JOB_POSTING_RE.test(text);
}

const DEFAULT_RANGE: TimeRange = { preset: "today" };

export async function runMonitoring(
  timeRange: TimeRange = DEFAULT_RANGE,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const range = resolveTimeRange(timeRange);
  const queries = (await getQueries()).filter((q) => q.enabled);

  const errors: string[] = [];
  let found = 0;
  let added = 0;

  for (const query of queries) {
    try {
      const candidates = await searchWeb(query.prompt, range);
      found += candidates.length;

      const toStore: Omit<Lead, "id" | "discoveredAt" | "status">[] = candidates
        .filter((c) => c.confidence >= MIN_CONFIDENCE)
        .filter((c) => dateWithinRange(c.publishedAt, range))
        .filter((c) => !looksLikeJobPosting(`${c.sourceTitle} ${c.summary}`))
        .map((c) => ({ ...c, queryId: query.id }));

      added += await addLeads(toStore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Query "${query.prompt.slice(0, 40)}…": ${msg}`);
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    queriesRun: queries.length,
    found,
    added,
    errors,
  };
}
