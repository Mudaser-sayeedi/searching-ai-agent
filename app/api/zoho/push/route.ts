import {
  leadsToPushItems,
  pushLeads,
  recordsToPushItems,
  type PushItem,
} from "@/lib/zoho";
import type { DirectoryRecord, Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Coerce an untrusted object into a DirectoryRecord, or null if unusable. */
function toRecord(raw: unknown): DirectoryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const company = str(r.company);
  if (!id || !company) return null;
  return {
    id,
    company,
    detailUrl: str(r.detailUrl),
    title: str(r.title),
    description: str(r.description),
    email: str(r.email) || undefined,
    phone: str(r.phone) || undefined,
    website: str(r.website) || undefined,
    address: str(r.address) || undefined,
    country: str(r.country) || undefined,
    areaServed: str(r.areaServed) || undefined,
    logo: str(r.logo) || undefined,
    services: strList(r.services),
    fetchedAt: str(r.fetchedAt) || new Date().toISOString(),
  };
}

/** Coerce an untrusted object into the Lead fields we actually push. */
function toLead(raw: unknown): Lead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const company = str(r.company);
  if (!id || !company) return null;
  return {
    ...(r as unknown as Lead),
    id,
    company,
    summary: str(r.summary),
    sourceUrl: str(r.sourceUrl),
    products: strList(r.products),
  };
}

// POST /api/zoho/push -> create Zoho CRM Leads from catalog records and/or
// discovered leads. Anything already in CRM comes back as "duplicate" and is
// never inserted a second time.
// body: { records?: DirectoryRecord[], leads?: Lead[] }
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      records?: unknown;
      leads?: unknown;
    };

    const records = (Array.isArray(body.records) ? body.records : [])
      .map(toRecord)
      .filter((r): r is DirectoryRecord => r !== null);
    const leads = (Array.isArray(body.leads) ? body.leads : [])
      .map(toLead)
      .filter((l): l is Lead => l !== null);

    if (records.length === 0 && leads.length === 0) {
      return Response.json(
        { error: "Nothing to push — no usable records or leads in the request." },
        { status: 400 },
      );
    }

    const items: PushItem[] = [
      ...recordsToPushItems(records),
      ...leadsToPushItems(leads),
    ];

    return Response.json({ results: await pushLeads(items) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
