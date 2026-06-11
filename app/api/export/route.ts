import { getLeads } from "@/lib/store";
import { SIGNAL_LABELS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Escape a value for CSV (RFC 4180): wrap in quotes, double internal quotes. */
function csv(value: string | number): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

const COLUMNS = [
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

// GET /api/export -> download all leads as a CSV file.
export async function GET() {
  const leads = await getLeads();

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

  // BOM so Excel reads UTF-8 correctly.
  const body = "﻿" + [COLUMNS.map(csv).join(","), ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zoho-leads-${date}.csv"`,
    },
  });
}
