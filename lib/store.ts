import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SearchQuery } from "./types";

// Simple, dependency-free JSON file store for the monitoring QUERIES (config).
// Leads are not stored here — see lib/leads-client.ts (localStorage).

const DATA_DIR = path.join(process.cwd(), "data");
const QUERIES_FILE = path.join(DATA_DIR, "queries.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Write to a temp file then rename for an atomic replace.
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/** Default queries seeded on first run so the tool is useful out of the box. */
const DEFAULT_QUERIES: Omit<SearchQuery, "id" | "createdAt">[] = [
  {
    prompt:
      "Companies that recently announced or publicly stated they use Zoho CRM, Zoho One, Zoho Books, or other Zoho products.",
    enabled: true,
  },
  {
    prompt:
      "Businesses publishing a request, RFP, or call for proposals seeking a Zoho implementation / consulting / customization / migration partner or agency.",
    enabled: true,
  },
  {
    prompt:
      "Companies announcing a migration to Zoho from another platform (e.g. Salesforce, HubSpot, QuickBooks) in news, blogs, or social media.",
    enabled: true,
  },
  {
    prompt:
      "Companies that mention using Zoho products in case studies, press releases, or LinkedIn posts (the organization itself, not recruiters).",
    enabled: true,
  },
];

// ---- Queries ----

export async function getQueries(): Promise<SearchQuery[]> {
  let queries = await readJson<SearchQuery[]>(QUERIES_FILE, []);
  if (queries.length === 0) {
    queries = DEFAULT_QUERIES.map((q) => ({
      ...q,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }));
    await writeJson(QUERIES_FILE, queries);
  }
  return queries;
}

// Queries are read-only on the server (defaults only). The user's custom
// queries and on/off overrides live client-side (see lib/queries-client.ts),
// and leads are returned by the agent run and stored in localStorage
// (see lib/leads-client.ts).
