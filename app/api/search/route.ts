import { runMonitoring } from "@/lib/agent";
import { COUNTRIES, type Country, type TimePreset, type TimeRange } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full run can take a while (one grounded call per query).
export const maxDuration = 300;

const VALID_PRESETS: TimePreset[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "any",
  "custom",
];

function parseRange(input: unknown): TimeRange {
  const r = (input ?? {}) as Partial<TimeRange>;
  const preset = VALID_PRESETS.includes(r.preset as TimePreset)
    ? (r.preset as TimePreset)
    : "today";
  return { preset, from: r.from, to: r.to };
}

function parseCountry(input: unknown): Country {
  return COUNTRIES.includes(input as Country) ? (input as Country) : "czech";
}

// Accept the enabled query prompts supplied by the client (strings, or
// { prompt } objects). Returns undefined so the agent falls back to server
// defaults when nothing usable is provided.
function parseQueries(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const prompts = input
    .map((q) =>
      typeof q === "string"
        ? q
        : q && typeof q === "object" && typeof (q as { prompt?: unknown }).prompt === "string"
          ? (q as { prompt: string }).prompt
          : "",
    )
    .map((s) => s.trim())
    .filter(Boolean);
  return prompts.length ? prompts : undefined;
}

// POST /api/search -> run the monitoring agent across all enabled queries.
// body: { timeRange?: { preset, from?, to? } }
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      timeRange?: unknown;
      queries?: unknown;
      country?: unknown;
    };
    const result = await runMonitoring(
      parseRange(body.timeRange),
      parseQueries(body.queries),
      parseCountry(body.country),
    );
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// GET /api/search -> same run, intended for scheduled triggers (cron).
// Protect it by setting CRON_SECRET and calling /api/search?secret=...&preset=today
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  if (secret && url.searchParams.get("secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runMonitoring(
      parseRange({
        preset: url.searchParams.get("preset") ?? "today",
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      }),
      undefined,
      parseCountry(url.searchParams.get("country")),
    );
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
