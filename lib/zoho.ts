import type { DirectoryRecord, Lead, ZohoPushResult } from "./types";

// Zoho CRM client: refresh-token OAuth + Leads create/lookup.
//
// Auth uses a self-client refresh token (this is a single-tenant internal
// tool, so there is no per-user login to broker). Generate one once in the
// Zoho API console and put it in .env — see the README.
//
// Duplicate safety is deliberately belt-and-braces: we ask Zoho what already
// exists BEFORE inserting, and we still treat Zoho's own DUPLICATE_DATA
// response as a non-error. The browser also remembers what it pushed, but that
// is only a display cache — CRM is the source of truth.

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsDomain: string;
  apiDomain: string;
  leadSource: string;
}

/** Czech/EU orgs are the common case here, so EU is the default data centre. */
const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.eu";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";
const DEFAULT_LEAD_SOURCE = "Vizitka.ai";

function trimDomain(value: string | undefined, fallback: string): string {
  const s = (value ?? "").trim().replace(/\/+$/, "");
  return s || fallback;
}

/** True when every credential needed to talk to Zoho is present. */
export function isZohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN,
  );
}

function getConfig(): ZohoConfig {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Zoho CRM is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN in .env (see README → Zoho CRM setup).",
    );
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    accountsDomain: trimDomain(
      process.env.ZOHO_ACCOUNTS_DOMAIN,
      DEFAULT_ACCOUNTS_DOMAIN,
    ),
    apiDomain: trimDomain(process.env.ZOHO_API_DOMAIN, DEFAULT_API_DOMAIN),
    leadSource: process.env.ZOHO_LEAD_SOURCE?.trim() || DEFAULT_LEAD_SOURCE,
  };
}

// ---- Automations fired on insert ----

const ALLOWED_TRIGGERS = ["workflow", "approval", "blueprint"] as const;
type ZohoTrigger = (typeof ALLOWED_TRIGGERS)[number];

/** Workflows run by default, so a lead created here behaves like a hand-entered one. */
const DEFAULT_TRIGGERS: ZohoTrigger[] = ["workflow"];

/**
 * Which Zoho automations to run when a lead is created. Workflow rules fire by
 * default — assignment rules, notifications and follow-up tasks all apply, the
 * same as for a lead entered by hand.
 *
 * Override with ZOHO_TRIGGERS, e.g. "workflow,blueprint" to add blueprints, or
 * "none" to insert silently (useful for a one-off bulk backfill).
 */
function getTriggers(): ZohoTrigger[] {
  const raw = process.env.ZOHO_TRIGGERS?.trim();
  if (!raw) return DEFAULT_TRIGGERS;
  if (raw.toLowerCase() === "none") return [];

  const parsed = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t): t is ZohoTrigger =>
      (ALLOWED_TRIGGERS as readonly string[]).includes(t),
    );
  // An unrecognised value must not silently disable automations.
  return parsed.length ? parsed : DEFAULT_TRIGGERS;
}

// ---- Access token ----

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must be refreshed. */
  expiresAt: number;
  apiDomain: string;
}

let tokenCache: CachedToken | null = null;
/** Refresh a minute early so a token cannot expire mid-request. */
const TOKEN_SKEW_MS = 60_000;

async function getAccessToken(config: ZohoConfig): Promise<CachedToken> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache;

  const params = new URLSearchParams({
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${config.accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    api_domain?: string;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Zoho token refresh failed (${res.status}): ${data.error ?? "no access_token returned"}. Check your client id/secret/refresh token and that ZOHO_ACCOUNTS_DOMAIN matches your data centre.`,
    );
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS,
    // Zoho tells us the right API domain for this org; prefer it unless the
    // operator pinned one explicitly.
    apiDomain: process.env.ZOHO_API_DOMAIN?.trim()
      ? config.apiDomain
      : trimDomain(data.api_domain, config.apiDomain),
  };
  return tokenCache;
}

/** Call the Zoho CRM API with a fresh access token. */
async function zohoFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = getConfig();
  const { token, apiDomain } = await getAccessToken(config);

  const res = await fetch(`${apiDomain}${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  // Search returns 204 with an empty body when nothing matches.
  if (res.status === 204) return { status: 204, body: {} };

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

// ---- Field mapping ----

/** The subset of Zoho Lead fields we write. */
type LeadPayload = Record<string, string>;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Build the Description body: what they do, plus where we found them. */
function describeRecord(record: DirectoryRecord): string {
  const parts = [record.title, record.description].filter(Boolean);
  if (record.services.length) {
    parts.push(`Services: ${record.services.join(", ")}`);
  }
  if (record.areaServed) parts.push(`Area served: ${record.areaServed}`);
  parts.push(`Source: ${record.detailUrl}`);
  return truncate(parts.join("\n\n"), 32000);
}

/** Map a catalog profile onto Zoho Lead fields. */
export function recordToLeadPayload(
  record: DirectoryRecord,
  leadSource: string,
): LeadPayload {
  const payload: LeadPayload = {
    // Last_Name is the only system-mandatory field on Leads. These are company
    // profiles with no named contact, so the company carries it.
    Last_Name: truncate(record.company, 120),
    Company: truncate(record.company, 200),
    Description: describeRecord(record),
    Lead_Source: leadSource,
  };
  if (record.email) payload.Email = record.email;
  if (record.phone) payload.Phone = record.phone;
  if (record.website) payload.Website = record.website;
  if (record.address) payload.City = truncate(record.address, 100);
  if (record.country) payload.Country = record.country;
  return payload;
}

/** Map a Gemini-discovered lead onto Zoho Lead fields. */
export function leadToLeadPayload(lead: Lead, leadSource: string): LeadPayload {
  const parts = [lead.summary];
  if (lead.products.length) parts.push(`Zoho products: ${lead.products.join(", ")}`);
  if (lead.sourceUrl) parts.push(`Source: ${lead.sourceUrl}`);
  return {
    Last_Name: truncate(lead.company || "Unknown", 120),
    Company: truncate(lead.company || "Unknown", 200),
    Description: truncate(parts.filter(Boolean).join("\n\n"), 32000),
    Lead_Source: leadSource,
  };
}

// ---- Lookup (duplicate prevention) ----

/** A lead that already exists in CRM, as returned by search. */
export interface ExistingLead {
  zohoId: string;
  email?: string;
  company?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function searchLeads(criteria: string): Promise<ExistingLead[]> {
  const path = `/crm/v8/Leads/search?criteria=${encodeURIComponent(criteria)}&fields=id,Email,Company,Last_Name&per_page=200`;
  const { status, body } = await zohoFetch(path);
  if (status === 204) return [];
  if (status >= 400) {
    throw new Error(
      `Zoho lead search failed (${status}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  return rows.map((r) => ({
    zohoId: String(r.id ?? ""),
    email: typeof r.Email === "string" ? r.Email.toLowerCase() : undefined,
    company:
      typeof r.Company === "string"
        ? r.Company
        : typeof r.Last_Name === "string"
          ? r.Last_Name
          : undefined,
  }));
}

/**
 * Look up which of these emails/companies already exist as Leads in CRM.
 * Returns lookup maps keyed by lowercased email and lowercased company name.
 *
 * Emails go through the `in` operator (up to 100 values per call). Company
 * names fall back to OR'd `equals` clauses — Zoho treats `equals` as
 * "contains" for text, so matches are re-checked exactly on our side.
 */
export async function findExistingLeads(
  emails: string[],
  companies: string[],
): Promise<{ byEmail: Map<string, ExistingLead>; byCompany: Map<string, ExistingLead> }> {
  const byEmail = new Map<string, ExistingLead>();
  const byCompany = new Map<string, ExistingLead>();

  const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  for (const batch of chunk(uniqueEmails, 100)) {
    for (const hit of await searchLeads(`(Email:in:${batch.join(",")})`)) {
      if (hit.email && !byEmail.has(hit.email)) byEmail.set(hit.email, hit);
      if (hit.company) {
        const key = hit.company.trim().toLowerCase();
        if (!byCompany.has(key)) byCompany.set(key, hit);
      }
    }
  }

  const uniqueCompanies = [...new Set(companies.map((c) => c.trim()).filter(Boolean))].filter(
    (c) => !byCompany.has(c.toLowerCase()),
  );
  // Zoho allows at most 10 criteria per search request.
  for (const batch of chunk(uniqueCompanies, 10)) {
    const criteria = batch.map((c) => `(Company:equals:${c.replace(/[(),]/g, " ")})`).join("or");
    const wanted = new Set(batch.map((c) => c.toLowerCase()));
    for (const hit of await searchLeads(criteria)) {
      const key = hit.company?.trim().toLowerCase();
      // `equals` is a contains-match for text, so keep only exact names.
      if (key && wanted.has(key) && !byCompany.has(key)) byCompany.set(key, hit);
      if (hit.email && !byEmail.has(hit.email)) byEmail.set(hit.email, hit);
    }
  }

  return { byEmail, byCompany };
}

// ---- Insert ----

interface InsertOutcome {
  code: string;
  message: string;
  zohoId?: string;
}

/** True when Zoho rejected the payload only because Lead_Source isn't a valid picklist value. */
function isBadLeadSource(body: Record<string, unknown>): boolean {
  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  return rows.some((r) => {
    if (r.code !== "INVALID_DATA") return false;
    const details = (r.details ?? {}) as Record<string, unknown>;
    return details.api_name === "Lead_Source" || details.expected_data_type === "picklist";
  });
}

async function postLeads(payloads: LeadPayload[]): Promise<InsertOutcome[]> {
  const trigger = getTriggers();
  const send = async (data: LeadPayload[]) =>
    zohoFetch("/crm/v8/Leads", {
      method: "POST",
      body: JSON.stringify({ data, trigger }),
    });

  let { status, body } = await send(payloads);

  // A CRM whose Lead_Source picklist lacks our value rejects the whole row;
  // retry once without it rather than making the user edit their picklist.
  if (isBadLeadSource(body)) {
    const stripped = payloads.map((p) => {
      const copy = { ...p };
      delete copy.Lead_Source;
      return copy;
    });
    ({ status, body } = await send(stripped));
  }

  if (status >= 400 && !Array.isArray(body.data)) {
    throw new Error(
      `Zoho lead insert failed (${status}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  }

  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  return rows.map((r) => {
    const details = (r.details ?? {}) as Record<string, unknown>;
    return {
      code: typeof r.code === "string" ? r.code : "UNKNOWN",
      message: typeof r.message === "string" ? r.message : "",
      zohoId: details.id ? String(details.id) : undefined,
    };
  });
}

/** One thing to push, tagged with our local id so results can be matched up. */
export interface PushItem {
  id: string;
  payload: LeadPayload;
  /** Used for the pre-insert duplicate lookup. */
  email?: string;
  company: string;
}

/** Build the push items for catalog records. */
export function recordsToPushItems(records: DirectoryRecord[]): PushItem[] {
  const { leadSource } = getConfig();
  return records.map((r) => ({
    id: r.id,
    payload: recordToLeadPayload(r, leadSource),
    email: r.email,
    company: r.company,
  }));
}

/** Build the push items for Gemini-discovered leads. */
export function leadsToPushItems(leads: Lead[]): PushItem[] {
  const { leadSource } = getConfig();
  return leads.map((l) => ({
    id: l.id,
    payload: leadToLeadPayload(l, leadSource),
    company: l.company,
  }));
}

/**
 * Create Leads in Zoho CRM, skipping anything that already exists there.
 * Never creates a second copy of a record that has been pushed before: the
 * pre-insert lookup catches prior pushes (even from another browser), and
 * Zoho's own DUPLICATE_DATA verdict is reported rather than treated as failure.
 */
export async function pushLeads(items: PushItem[]): Promise<ZohoPushResult[]> {
  if (items.length === 0) return [];

  const { byEmail, byCompany } = await findExistingLeads(
    items.map((i) => i.email ?? "").filter(Boolean),
    items.map((i) => i.company),
  );

  const results = new Map<string, ZohoPushResult>();
  const toInsert: PushItem[] = [];

  for (const item of items) {
    const existing =
      (item.email ? byEmail.get(item.email.toLowerCase()) : undefined) ??
      byCompany.get(item.company.trim().toLowerCase());

    if (existing) {
      results.set(item.id, {
        id: item.id,
        status: "duplicate",
        zohoId: existing.zohoId,
        message: "Already in Zoho CRM",
      });
    } else {
      toInsert.push(item);
    }
  }

  // Zoho accepts up to 100 records per insert call.
  for (const batch of chunk(toInsert, 100)) {
    let outcomes: InsertOutcome[];
    try {
      outcomes = await postLeads(batch.map((i) => i.payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const item of batch) {
        results.set(item.id, { id: item.id, status: "error", message });
      }
      continue;
    }

    batch.forEach((item, i) => {
      const outcome = outcomes[i];
      if (!outcome) {
        results.set(item.id, {
          id: item.id,
          status: "error",
          message: "No response row from Zoho for this record",
        });
      } else if (outcome.code === "SUCCESS") {
        results.set(item.id, {
          id: item.id,
          status: "created",
          zohoId: outcome.zohoId,
          message: outcome.message || "Created",
        });
      } else if (outcome.code === "DUPLICATE_DATA") {
        results.set(item.id, {
          id: item.id,
          status: "duplicate",
          zohoId: outcome.zohoId,
          message: "Already in Zoho CRM",
        });
      } else {
        results.set(item.id, {
          id: item.id,
          status: "error",
          message: `${outcome.code}: ${outcome.message}`,
        });
      }
    });
  }

  return items.map(
    (i) =>
      results.get(i.id) ?? {
        id: i.id,
        status: "error" as const,
        message: "Not processed",
      },
  );
}

/**
 * Base URL of the Zoho CRM web app for this data centre, so the UI can deep
 * link to a lead: `${crmBaseUrl()}/crm/tab/Leads/${zohoId}`.
 */
export function crmBaseUrl(): string {
  const api = trimDomain(process.env.ZOHO_API_DOMAIN, DEFAULT_API_DOMAIN);
  // https://www.zohoapis.eu -> https://crm.zoho.eu
  return api.replace(/^https?:\/\/(?:www\.)?zohoapis\./, "https://crm.zoho.");
}
