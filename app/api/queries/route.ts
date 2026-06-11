import { addQuery, deleteQuery, getQueries, updateQuery } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/queries -> all monitoring queries
export async function GET() {
  const queries = await getQueries();
  return Response.json({ queries });
}

// POST /api/queries -> add a query. body: { prompt: string }
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
  } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const query = await addQuery(prompt);
  return Response.json({ query }, { status: 201 });
}

// PATCH /api/queries -> update a query. body: { id, prompt?, enabled? }
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    prompt?: string;
    enabled?: boolean;
  } | null;
  if (!body?.id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const query = await updateQuery(body.id, {
    prompt: body.prompt,
    enabled: body.enabled,
  });
  if (!query) return Response.json({ error: "query not found" }, { status: 404 });
  return Response.json({ query });
}

// DELETE /api/queries?id=... -> remove a query
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deleteQuery(id);
  return Response.json({ ok: true });
}
