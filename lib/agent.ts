import { randomUUID } from "node:crypto";
import { searchWeb } from "./gemini";
import { getQueries } from "./store";
import { dedupeLeads } from "./leads-shared";
import { dateWithinRange, resolveTimeRange } from "./time";
import type { Country, Lead, RunResult, TimeRange } from "./types";

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

// Safety net: drop COMPLETED implementations and partner/vendor case studies —
// these are finished deals, not prospects with buying intent.
const COMPLETED_RE =
  /\b(has|have|had|already|recently)\s+(migrated|implemented|deployed|adopted|switched|moved|rolled out|onboarded|completed)\b|\bnow uses?\b|\bsuccessfully (implemented|deployed|migrated|rolled out|adopted)\b|\bcase study\b|\bsuccess story\b|\bwe helped\b|\bhelped\b[^.]*\b(implement|migrat|deploy|set up|adopt)\b/i;

function looksCompleted(text: string): boolean {
  return COMPLETED_RE.test(text);
}

// Safety net: drop informational CONTENT (blogs, tutorials, help docs, vendor
// pages) — these are articles, not a buyer expressing a need.
const CONTENT_TITLE_RE =
  /\b(how to|step[- ]by[- ]step|tutorial|guide|ultimate|complete guide|getting started|documentation|knowledge base|help center|user manual|cheat sheet|best practices|tips( and| &)? tricks|top \d+|\d+ (best|ways|tips)|review|vs\.?|comparison|what is|introduction to|explained|FAQ)\b/i;

// Hosts that serve docs/help/marketing rather than leads.
const CONTENT_HOST_RE =
  /(^|\.)zoho\.com$|^(help|docs?|support|kb|blog|learn|academy|guide|developer|developers)\./i;

function looksLikeContent(title: string, summary: string, url: string): boolean {
  let host = "";
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    /* ignore */
  }
  if (host && CONTENT_HOST_RE.test(host)) return true;
  return CONTENT_TITLE_RE.test(`${title} ${summary}`);
}

const DEFAULT_RANGE: TimeRange = { preset: "today" };
const DEFAULT_COUNTRY: Country = "czech";

/**
 * Run the monitoring agent. `queryPrompts` are the enabled queries supplied by
 * the client (defaults + the user's localStorage custom queries). When omitted
 * (e.g. a cron trigger), the server's seeded default queries are used. `country`
 * scopes the search to a region (defaults to Czech Republic).
 */
export async function runMonitoring(
  timeRange: TimeRange = DEFAULT_RANGE,
  queryPrompts?: string[],
  country: Country = DEFAULT_COUNTRY,
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
      const candidates = await searchWeb(query.prompt, range, country);
      found += candidates.length;

      for (const c of candidates) {
        const text = `${c.sourceTitle} ${c.summary}`;
        if (c.confidence < MIN_CONFIDENCE) continue;
        if (!dateWithinRange(c.publishedAt, range)) continue;
        if (looksLikeJobPosting(text)) continue;
        if (looksCompleted(text)) continue;
        if (looksLikeContent(c.sourceTitle, c.summary, c.sourceUrl)) continue;

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
