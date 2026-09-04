import { promises as fs } from "node:fs";
import path from "node:path";
import type { DirectoryRecord } from "./types";

// Scraper for the Vizitka.ai business-card catalog (https://www.vizitka.ai).
//
// Every profile page embeds a JSON-LD @graph containing an Organization and a
// LocalBusiness node with the company's real name, email, phone, website,
// address and service list. We read THAT rather than the rendered markup, so
// the extraction survives CSS/layout changes and never guesses a value.
//
// The catalog is small (tens of profiles) and its robots.txt allows crawling,
// but we still cache aggressively and fetch detail pages with a small
// concurrency limit to stay polite.

const BASE = "https://www.vizitka.ai";
const CATALOG_PATH = "/katalog-vizitek";
const USER_AGENT = "ZohoSignalMonitor/1.0 (+catalog sync; contact via site owner)";

/** Stop after this many listing pages, whatever the site claims. */
const MAX_PAGES = 25;
/** Parallel detail-page fetches. */
const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 15000;

const CACHE_FILE = path.join(process.cwd(), "data", "vizitka-catalog.json");
/** How long a cached scrape stays fresh. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface CacheShape {
  fetchedAt: string;
  records: DirectoryRecord[];
}

/** Process-local cache so repeated requests in one session cost nothing. */
let memoryCache: CacheShape | null = null;

// ---- HTTP ----

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "cs,en;q=0.8" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// ---- Listing pages ----

const DETAIL_HREF_RE = /https:\/\/www\.vizitka\.ai\/v\/(\d+)\/[^"'\s]*/g;

/** A profile as linked from a listing page. */
interface ProfileLink {
  id: string;
  /** Full slug URL. `/v/{id}` only 302-redirects here, so use it directly. */
  url: string;
}

/** Profiles linked from one listing page, in the order they appear. */
function detailLinksOn(html: string): ProfileLink[] {
  const links: ProfileLink[] = [];
  for (const m of html.matchAll(DETAIL_HREF_RE)) {
    if (!links.some((l) => l.id === m[1])) links.push({ id: m[1], url: m[0] });
  }
  return links;
}

function listingUrl(page: number, query?: string): string {
  const suffix = page > 1 ? `/${page}` : "";
  const qs = query ? `?filters%5Bquery%5D=${encodeURIComponent(query)}` : "";
  return `${BASE}${CATALOG_PATH}${suffix}${qs}`;
}

/**
 * Walk the catalog listing and collect every profile. Stops when a page adds
 * nothing new (the site serves the last page again past the end).
 */
async function collectProfileLinks(query?: string): Promise<ProfileLink[]> {
  const all: ProfileLink[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await getText(listingUrl(page, query));
    const fresh = detailLinksOn(html).filter(
      (link) => !all.some((l) => l.id === link.id),
    );
    if (fresh.length === 0) break;
    all.push(...fresh);
  }
  return all;
}

// ---- Detail pages (JSON-LD) ----

const LD_JSON_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

type LdNode = Record<string, unknown>;

/** Every JSON-LD node on the page, flattening any @graph wrappers. */
function ldNodes(html: string): LdNode[] {
  const nodes: LdNode[] = [];
  for (const m of html.matchAll(LD_JSON_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // a malformed block must not sink the whole record
    }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      if (!root || typeof root !== "object") continue;
      const graph = (root as LdNode)["@graph"];
      if (Array.isArray(graph)) {
        nodes.push(...(graph.filter((g) => g && typeof g === "object") as LdNode[]));
      } else {
        nodes.push(root as LdNode);
      }
    }
  }
  return nodes;
}

function nodeOfType(nodes: LdNode[], type: string): LdNode | undefined {
  return nodes.find((n) => {
    const t = n["@type"];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

/**
 * The site stores HTML entities inside its JSON-LD values (e.g. "Praha
 * a&nbsp;okolí"), so decode them before the text reaches the UI or Zoho.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Non-breaking spaces read as ordinary spaces once decoded.
  const s = decodeEntities(value).replace(/ /g, " ").trim();
  return s ? s : undefined;
}

/** "00420605431301" / "605431301" -> "+420 605 431 301". */
function normalizePhone(raw: unknown): string | undefined {
  const s = str(raw);
  if (!s) return undefined;
  let digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  else if (!digits.startsWith("+") && digits.length === 9) digits = `+420${digits}`;
  const cz = digits.match(/^\+420(\d{3})(\d{3})(\d{3})$/);
  return cz ? `+420 ${cz[1]} ${cz[2]} ${cz[3]}` : digits || undefined;
}

/** Reject placeholders like a bare "https://" that the site sometimes stores. */
function normalizeWebsite(raw: unknown): string | undefined {
  const s = str(raw);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.hostname ? u.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEmail(raw: unknown): string | undefined {
  const s = str(raw)?.toLowerCase();
  return s && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s) ? s : undefined;
}

/** A PostalAddress's human-readable location line. */
function addressLine(address: unknown): string | undefined {
  if (!address || typeof address !== "object") return str(address);
  const a = address as LdNode;
  const parts = [str(a.streetAddress), str(a.addressLocality), str(a.postalCode)];
  const line = parts.filter(Boolean).join(", ");
  return line || undefined;
}

/** areaServed is either a string or a Place node. */
function areaServedName(area: unknown): string | undefined {
  if (!area || typeof area !== "object") return str(area);
  return str((area as LdNode).name);
}

/** Service names from makesOffer -> Offer.itemOffered.name. */
function offeredServices(makesOffer: unknown): string[] {
  if (!Array.isArray(makesOffer)) return [];
  return makesOffer
    .map((offer) => {
      if (!offer || typeof offer !== "object") return undefined;
      const item = (offer as LdNode).itemOffered;
      if (!item || typeof item !== "object") return undefined;
      return str((item as LdNode).name);
    })
    .filter((s): s is string => Boolean(s));
}

/** Build a DirectoryRecord from one profile page, or null if it has no JSON-LD. */
function parseProfile(id: string, html: string): DirectoryRecord | null {
  const nodes = ldNodes(html);
  const org = nodeOfType(nodes, "Organization");
  const biz = nodeOfType(nodes, "LocalBusiness");
  const primary = org ?? biz;
  if (!primary) return null;

  // Prefer whichever node actually carries each value — the two nodes overlap
  // but are not always populated identically.
  const pick = (key: string): unknown =>
    (primary[key] ?? biz?.[key] ?? org?.[key]) as unknown;

  const title = str(pick("name")) ?? "";
  const company = str(pick("legalName")) ?? title;
  if (!company) return null;

  const address = biz?.address ?? org?.address;

  return {
    id: `vizitka-${id}`,
    detailUrl: `${BASE}/v/${id}`,
    title,
    company,
    description: str(pick("description")) ?? "",
    email: normalizeEmail(pick("email")),
    phone: normalizePhone(pick("telephone")),
    website: normalizeWebsite(pick("url")),
    address: addressLine(address),
    country:
      address && typeof address === "object"
        ? str((address as LdNode).addressCountry)
        : undefined,
    areaServed: areaServedName(pick("areaServed")),
    logo: normalizeWebsite(pick("logo")) ?? str(pick("logo")),
    services: offeredServices(pick("makesOffer")),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch and parse one profile. Returns null (never throws) on failure, but
 * retries once first — under concurrency the site occasionally drops a request,
 * and a silently missing profile is a missing lead.
 */
async function fetchProfile(link: ProfileLink): Promise<DirectoryRecord | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseProfile(link.id, await getText(link.url));
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 750));
    }
  }
  return null;
}

/** Run `worker` over `items` with at most CONCURRENCY in flight. */
async function mapPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---- Disk cache ----

async function readCache(): Promise<CacheShape | null> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as CacheShape;
    if (!Array.isArray(parsed?.records)) return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(cache: CacheShape): Promise<void> {
  memoryCache = cache;
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // A read-only deployment still works — the memory cache carries the run.
  }
}

function isFresh(cache: CacheShape): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS;
}

// ---- Public API ----

export interface CatalogResult {
  records: DirectoryRecord[];
  fetchedAt: string;
  /** True when served from cache rather than freshly scraped. */
  cached: boolean;
  /** Profile ids that were listed but could not be fetched or parsed. */
  skipped: string[];
}

/**
 * Fetch the full Vizitka.ai catalog. Served from cache unless `refresh` is set
 * or the cache has aged out. `query` runs the site's own search instead of
 * listing everything (never cached, since it is a narrowed view).
 */
export async function getCatalog(
  { refresh = false, query }: { refresh?: boolean; query?: string } = {},
): Promise<CatalogResult> {
  const search = query?.trim();

  if (!search && !refresh) {
    const cache = await readCache();
    if (cache && isFresh(cache)) {
      return { ...cache, cached: true, skipped: [] };
    }
  }

  const links = await collectProfileLinks(search);
  const parsed = await mapPool(links, fetchProfile);
  const records = parsed.filter((r): r is DirectoryRecord => r !== null);
  const fetchedAt = new Date().toISOString();

  const skipped = links
    .filter((link) => !records.some((r) => r.id === `vizitka-${link.id}`))
    .map((link) => link.id);

  if (!search) {
    // Keep any profile we failed to re-fetch this time rather than dropping it
    // from the catalog — a transient blip must not lose a lead.
    const previous = await readCache();
    const kept = (previous?.records ?? []).filter((old) =>
      skipped.includes(old.id.replace("vizitka-", "")),
    );
    await writeCache({ fetchedAt, records: [...records, ...kept] });
    return { records: [...records, ...kept], fetchedAt, cached: false, skipped };
  }

  return { records, fetchedAt, cached: false, skipped };
}
