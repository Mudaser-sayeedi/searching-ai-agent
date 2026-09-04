import type { ZohoPushResult } from "./types";

// Browser-side memory of what has already been pushed into Zoho CRM, so a
// record that was created earlier shows as "In CRM" the moment the page loads
// — no API round-trip needed to render the right state.
//
// This is a CACHE, not the source of truth. Clearing site data must not cause
// duplicates, so the server re-checks CRM before every insert
// (see lib/zoho.ts -> pushLeads) and /api/zoho/check re-seeds this map.

const STORAGE_KEY = "zoho-crm-links";

/** A record known to exist in Zoho CRM. */
export interface CrmLink {
  /** Zoho's Lead record id, when known. */
  zohoId?: string;
  /** ISO timestamp of when we first saw it in CRM. */
  linkedAt: string;
  /** "created" = we made it; "duplicate" = it was already there. */
  origin: "created" | "duplicate";
}

/** Keyed by our local id (DirectoryRecord.id or Lead.id). */
export type CrmLinks = Record<string, CrmLink>;

export function loadCrmLinks(): CrmLinks {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CrmLinks) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCrmLinks(links: CrmLinks): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch {
    // Storage full or blocked — the server-side check still prevents duplicates.
  }
}

/**
 * Fold push results into the link map. Both "created" and "duplicate" mean the
 * record now exists in CRM, so both are remembered; errors are not.
 * An existing entry is never overwritten, so the original linkedAt survives.
 */
export function applyPushResults(links: CrmLinks, results: ZohoPushResult[]): CrmLinks {
  const next = { ...links };
  for (const result of results) {
    if (result.status === "error") continue;
    const previous = next[result.id];
    next[result.id] = {
      zohoId: result.zohoId ?? previous?.zohoId,
      linkedAt: previous?.linkedAt ?? new Date().toISOString(),
      origin: previous?.origin ?? result.status,
    };
  }
  return next;
}

/**
 * Fold a server-side existence check into the link map — this is how a fresh
 * browser learns which records are already in CRM.
 */
export function applyExisting(
  links: CrmLinks,
  existing: Record<string, { zohoId?: string }>,
): CrmLinks {
  const next = { ...links };
  for (const [id, hit] of Object.entries(existing)) {
    const previous = next[id];
    next[id] = {
      zohoId: hit.zohoId ?? previous?.zohoId,
      linkedAt: previous?.linkedAt ?? new Date().toISOString(),
      origin: previous?.origin ?? "duplicate",
    };
  }
  return next;
}

/** Deep link to the lead in the Zoho CRM web app. */
export function crmLeadUrl(crmBaseUrl: string, zohoId: string): string {
  return `${crmBaseUrl.replace(/\/$/, "")}/crm/tab/Leads/${zohoId}`;
}
