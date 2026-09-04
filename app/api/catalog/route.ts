import { getCatalog } from "@/lib/vizitka";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold scrape fetches every listing page plus one page per profile.
export const maxDuration = 300;

// GET /api/catalog -> business profiles from the Vizitka.ai catalog.
//   ?refresh=1   bypass the 12h cache and re-scrape
//   ?q=<text>    run the site's own search instead of listing everything
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await getCatalog({
      refresh: url.searchParams.get("refresh") === "1",
      query: url.searchParams.get("q") ?? undefined,
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
