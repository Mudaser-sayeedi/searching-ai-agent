import { findExistingLeads, isZohoConfigured } from "@/lib/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface CheckItem {
  id: string;
  email?: string;
  company: string;
}

function toCheckItem(raw: unknown): CheckItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const company = typeof r.company === "string" ? r.company.trim() : "";
  if (!id || !company) return null;
  const email = typeof r.email === "string" ? r.email.trim() : "";
  return { id, company, email: email || undefined };
}

// POST /api/zoho/check -> which of these are ALREADY Leads in Zoho CRM.
// This is what makes "already created" survive a cleared browser: CRM itself
// is asked, not just local state.
// body: { items: [{ id, company, email? }] }
// -> { existing: { [id]: { zohoId } } }
export async function POST(request: Request) {
  if (!isZohoConfigured()) {
    return Response.json({ existing: {}, configured: false });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { items?: unknown };
    const items = (Array.isArray(body.items) ? body.items : [])
      .map(toCheckItem)
      .filter((i): i is CheckItem => i !== null);

    if (items.length === 0) return Response.json({ existing: {}, configured: true });

    const { byEmail, byCompany } = await findExistingLeads(
      items.map((i) => i.email ?? "").filter(Boolean),
      items.map((i) => i.company),
    );

    const existing: Record<string, { zohoId: string }> = {};
    for (const item of items) {
      const hit =
        (item.email ? byEmail.get(item.email.toLowerCase()) : undefined) ??
        byCompany.get(item.company.toLowerCase());
      if (hit) existing[item.id] = { zohoId: hit.zohoId };
    }

    return Response.json({ existing, configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
