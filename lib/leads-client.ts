import { dedupeLeads } from "./leads-shared";
import { SIGNAL_LABELS, type Lead } from "./types";

// Browser-only persistence for leads. The agent run returns leads over HTTP;
// the client merges them into localStorage. Call these only on the client.

const STORAGE_KEY = "zoho-leads";

export function loadLeads(): Lead[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Lead[]) : [];
    return Array.isArray(parsed) ? sortNewest(parsed) : [];
  } catch {
    return [];
  }
}

export function saveLeads(leads: Lead[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
}

export function clearLeads(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function sortNewest(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
}

/**
 * Merge freshly-discovered leads into the existing set. Existing leads win on
 * conflict (so their reviewed/dismissed status is preserved). Returns the merged
 * list (newest first) and how many were actually new.
 */
export function mergeLeads(
  existing: Lead[],
  incoming: Lead[],
): { merged: Lead[]; added: number } {
  const merged = dedupeLeads([...existing, ...incoming]);
  return { merged: sortNewest(merged), added: merged.length - existing.length };
}

const CSV_COLUMNS = [
  "Company",
  "Signal",
  "Zoho products",
  "Summary",
  "Source title",
  "Source URL",
  "Confidence %",
  "Published",
  "Discovered",
  "Status",
];

/** Escape a value for CSV (RFC 4180): wrap in quotes, double internal quotes. */
function csv(value: string | number): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** Build an Excel-friendly CSV string (with BOM) from the given leads. */
export function leadsToCsv(leads: Lead[]): string {
  const rows = leads.map((l) =>
    [
      csv(l.company),
      csv(SIGNAL_LABELS[l.signalType] ?? l.signalType),
      csv(l.products.join("; ")),
      csv(l.summary),
      csv(l.sourceTitle),
      csv(l.sourceUrl),
      csv(Math.round(l.confidence * 100)),
      csv(l.publishedAt ?? ""),
      csv(l.discoveredAt),
      csv(l.status),
    ].join(","),
  );
  return "﻿" + [CSV_COLUMNS.map(csv).join(","), ...rows].join("\r\n");
}

/** Trigger a browser download of the leads as a CSV file. */
export function downloadLeadsCsv(leads: Lead[]): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([leadsToCsv(leads)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zoho-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
