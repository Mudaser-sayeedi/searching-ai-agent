import { getLeads, updateLeadStatus } from "@/lib/store";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/leads -> all stored leads (newest first)
export async function GET() {
  const leads = await getLeads();
  return Response.json({ leads });
}

// PATCH /api/leads -> update a lead's workflow status
// body: { id: string, status: "new" | "reviewed" | "dismissed" }
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    status?: Lead["status"];
  } | null;

  if (!body?.id || !body.status) {
    return Response.json({ error: "id and status are required" }, { status: 400 });
  }
  if (!["new", "reviewed", "dismissed"].includes(body.status)) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }

  const lead = await updateLeadStatus(body.id, body.status);
  if (!lead) return Response.json({ error: "lead not found" }, { status: 404 });
  return Response.json({ lead });
}
