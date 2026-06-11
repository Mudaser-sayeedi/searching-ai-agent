import { getQueries } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/queries -> the seeded DEFAULT monitoring queries.
// Custom queries the user adds are stored client-side in localStorage
// (see lib/queries-client.ts), so this endpoint is read-only.
export async function GET() {
  const queries = await getQueries();
  return Response.json({ queries });
}
