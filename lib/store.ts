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

/**
 * Default queries seeded on first run. These target BUYING INTENT — companies
 * that need a Zoho partner — not companies that already use Zoho.
 */
const DEFAULT_QUERIES: Omit<SearchQuery, "id" | "createdAt">[] = [
  {
    prompt:
      "Businesses publicly looking for a Zoho partner, consultant, developer, or agency to implement, customize, or migrate to Zoho. Include posts like 'looking for a Zoho expert' or 'need help setting up Zoho CRM'.",
    enabled: true,
  },
  {
    prompt:
      "Open RFPs, RFQs, tenders, or requests for proposals where an organization is seeking Zoho CRM / Zoho One / Zoho Books / Zoho Creator implementation or migration services.",
    enabled: true,
  },
  {
    prompt:
      "People asking for advice or recommendations about adopting or moving to Zoho on forums, Reddit, Quora, or LinkedIn (e.g. 'should we switch to Zoho', 'is Zoho One worth it for our company', 'how to migrate to Zoho').",
    enabled: true,
  },
  {
    prompt:
      "Companies expressing frustration with their current CRM/accounting/helpdesk tool and considering Zoho as an alternative, or planning to evaluate Zoho.",
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
