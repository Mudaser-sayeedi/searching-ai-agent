import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Lead, SearchQuery } from "./types";

// Simple, dependency-free JSON file store. Fine for a single-user local
// monitoring tool: low write volume, no concurrent writers. Each entity is
// kept in its own file under /data (gitignored). Swap this module out for a
// real database later without touching the rest of the app.

const DATA_DIR = path.join(process.cwd(), "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
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

// Serialize all read-modify-write sequences so concurrent runs (e.g. two search
// requests in flight) can't clobber each other's writes. Single-process, in-memory
// mutex implemented as a promise chain — sufficient for this single-instance app.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // Keep the chain alive regardless of individual success/failure.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

export function addQuery(prompt: string): Promise<SearchQuery> {
  return withLock(async () => {
    const queries = await getQueries();
    const query: SearchQuery = {
      id: randomUUID(),
      prompt: prompt.trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    queries.push(query);
    await writeJson(QUERIES_FILE, queries);
    return query;
  });
}

export function updateQuery(
  id: string,
  patch: Partial<Pick<SearchQuery, "prompt" | "enabled">>,
): Promise<SearchQuery | null> {
  return withLock(async () => {
    const queries = await getQueries();
    const q = queries.find((x) => x.id === id);
    if (!q) return null;
    if (patch.prompt !== undefined) q.prompt = patch.prompt.trim();
    if (patch.enabled !== undefined) q.enabled = patch.enabled;
    await writeJson(QUERIES_FILE, queries);
    return q;
  });
}

export function deleteQuery(id: string): Promise<void> {
  return withLock(async () => {
    const queries = await getQueries();
    await writeJson(
      QUERIES_FILE,
      queries.filter((q) => q.id !== id),
    );
  });
}

// ---- Leads ----

export async function getLeads(): Promise<Lead[]> {
  const leads = await readJson<Lead[]>(LEADS_FILE, []);
  // Newest first.
  return leads.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
}

/** Normalize a URL for dedupe (drop protocol, trailing slash, www; keep query). */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}${u.search}`
      .replace(/\/$/, "")
      .toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Insert candidate leads, skipping ones we already have (matched by source URL,
 * or by company + signal type as a fallback). Returns the number actually added.
 */
export function addLeads(
  candidates: Omit<Lead, "id" | "discoveredAt" | "status">[],
): Promise<number> {
  return withLock(() => addLeadsUnlocked(candidates));
}

async function addLeadsUnlocked(
  candidates: Omit<Lead, "id" | "discoveredAt" | "status">[],
): Promise<number> {
  const existing = await readJson<Lead[]>(LEADS_FILE, []);
  const seenUrls = new Set(existing.map((l) => urlKey(l.sourceUrl)));
  const seenPairs = new Set(
    existing.map((l) => `${l.company.toLowerCase()}::${l.signalType}`),
  );

  let added = 0;
  for (const c of candidates) {
    const uKey = urlKey(c.sourceUrl);
    const pairKey = `${c.company.toLowerCase()}::${c.signalType}`;
    if (c.sourceUrl && seenUrls.has(uKey)) continue;
    if (!c.sourceUrl && seenPairs.has(pairKey)) continue;

    existing.push({
      ...c,
      id: randomUUID(),
      discoveredAt: new Date().toISOString(),
      status: "new",
    });
    if (uKey) seenUrls.add(uKey);
    seenPairs.add(pairKey);
    added++;
  }

  if (added > 0) await writeJson(LEADS_FILE, existing);
  return added;
}

export function updateLeadStatus(
  id: string,
  status: Lead["status"],
): Promise<Lead | null> {
  return withLock(async () => {
    const leads = await readJson<Lead[]>(LEADS_FILE, []);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    lead.status = status;
    await writeJson(LEADS_FILE, leads);
    return lead;
  });
}
