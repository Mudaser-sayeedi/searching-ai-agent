import { randomUUID } from "node:crypto";
import { searchWeb } from "./gemini";
import { getQueries } from "./store";
import { dedupeLeads } from "./leads-shared";
import { dateWithinRange, resolveTimeRange } from "./time";
import type { Lead, RunResult, TimeRange } from "./types";

// Orchestrates a full monitoring run: for every enabled query, search the web
// via Gemini within the requested recency window, filter, and dedupe. The
// resulting leads are RETURNED (not persisted) — the client stores them in
// localStorage.

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

/**
 * Run the monitoring agent. `queryPrompts` are the enabled queries supplied by
 * the client (defaults + the user's localStorage custom queries). When omitted
 * (e.g. a cron trigger), the server's seeded default queries are used.
 */
export async function runMonitoring(
  timeRange: TimeRange = DEFAULT_RANGE,
  queryPrompts?: string[],
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const range = resolveTimeRange(timeRange);

  const queries =
    queryPrompts && queryPrompts.length
      ? queryPrompts.map((prompt, i) => ({ id: `req-${i}`, prompt }))
      : (await getQueries())
          .filter((q) => q.enabled)
          .map((q) => ({ id: q.id, prompt: q.prompt }));

  const errors: string[] = [];
  const leads: Lead[] = [];
  let found = 0;

  for (const query of queries) {
    try {
      const candidates = await searchWeb(query.prompt, range);
      found += candidates.length;

      for (const c of candidates) {
        if (c.confidence < MIN_CONFIDENCE) continue;
        if (!dateWithinRange(c.publishedAt, range)) continue;
        if (looksLikeJobPosting(`${c.sourceTitle} ${c.summary}`)) continue;

        leads.push({
          ...c,
          queryId: query.id,
          id: randomUUID(),
          discoveredAt: new Date().toISOString(),
          status: "new",
        });
      }
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
    errors,
    leads: dedupeLeads(leads),
  };
}
