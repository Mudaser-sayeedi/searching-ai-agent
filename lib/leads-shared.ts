import type { Lead } from "./types";

// Pure helpers shared by the server (batch dedupe within a run) and the client
// (merging new leads into localStorage). No I/O, no browser/node specifics.

/** Normalize a URL for dedupe (drop protocol, trailing slash, www; keep query). */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}${u.search}`
      .replace(/\/$/, "")
      .toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Remove duplicate leads, keeping the FIRST occurrence. Two leads are the same
 * if they share a source URL, or (when a URL is missing) the same company +
 * signal type. Order is preserved so callers control which copy wins.
 */
export function dedupeLeads(leads: Lead[]): Lead[] {
  const seenUrls = new Set<string>();
  const seenPairs = new Set<string>();
  const out: Lead[] = [];

  for (const lead of leads) {
    const uKey = urlKey(lead.sourceUrl);
    const pairKey = `${lead.company.toLowerCase()}::${lead.signalType}`;
    if (lead.sourceUrl && seenUrls.has(uKey)) continue;
    if (!lead.sourceUrl && seenPairs.has(pairKey)) continue;

    if (lead.sourceUrl) seenUrls.add(uKey);
    seenPairs.add(pairKey);
    out.push(lead);
  }
  return out;
}
