import type { SearchQuery } from "./types";

// Browser-only management of monitoring queries.
//
//  - DEFAULT queries are seeded on the server and fetched over HTTP (read-only
//    source of truth). The user can enable/disable them; that on/off override is
//    remembered in localStorage.
//  - CUSTOM queries the user adds live entirely in localStorage.
//
// The effective list the agent runs is defaults (with overrides applied) plus
// the user's custom queries.

const CUSTOM_KEY = "zoho-queries-custom";
const OVERRIDE_KEY = "zoho-queries-overrides";

/** A query plus whether it came from the server defaults or local custom set. */
export interface EffectiveQuery extends SearchQuery {
  isDefault: boolean;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function loadCustom(): SearchQuery[] {
  const list = read<SearchQuery[]>(CUSTOM_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Enabled-state overrides for default queries, keyed by query id. */
function loadOverrides(): Record<string, boolean> {
  return read<Record<string, boolean>>(OVERRIDE_KEY, {});
}

/** Combine server defaults (with local on/off overrides) and custom queries. */
export function getEffectiveQueries(defaults: SearchQuery[]): EffectiveQuery[] {
  const overrides = loadOverrides();
  const defaultQueries: EffectiveQuery[] = defaults.map((d) => ({
    ...d,
    enabled: overrides[d.id] ?? d.enabled,
    isDefault: true,
  }));
  const custom: EffectiveQuery[] = loadCustom().map((c) => ({
    ...c,
    isDefault: false,
  }));
  return [...defaultQueries, ...custom];
}

export function addCustomQuery(prompt: string): void {
  const list = loadCustom();
  list.push({
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `custom-${Date.now()}`,
    prompt: prompt.trim(),
    enabled: true,
    createdAt: new Date().toISOString(),
  });
  write(CUSTOM_KEY, list);
}

/** Toggle a query on/off — overrides for defaults, in-place for custom. */
export function toggleQuery(query: EffectiveQuery): void {
  if (query.isDefault) {
    const overrides = loadOverrides();
    overrides[query.id] = !query.enabled;
    write(OVERRIDE_KEY, overrides);
  } else {
    const list = loadCustom();
    const c = list.find((x) => x.id === query.id);
    if (c) {
      c.enabled = !c.enabled;
      write(CUSTOM_KEY, list);
    }
  }
}

/** Remove a custom query (defaults cannot be removed, only disabled). */
export function removeCustomQuery(id: string): void {
  write(
    CUSTOM_KEY,
    loadCustom().filter((q) => q.id !== id),
  );
}
