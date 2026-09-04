// Shared domain types for the Zoho monitoring agent.

/** The kind of signal a lead represents. */
// A lead is a company with BUYING INTENT for Zoho services — it needs help and
// has not implemented yet. These categories describe the kind of need expressed.
export type SignalType =
  | "seeking_partner" // looking for a Zoho partner / consultant / developer
  | "rfp" // formal RFP / tender / request for proposal for Zoho work
  | "evaluating" // considering / comparing Zoho before adopting
  | "needs_help" // wants to adopt or is stuck and asking for help/guidance
  | "other"; // some other genuine intent signal

export const SIGNAL_TYPES: SignalType[] = [
  "seeking_partner",
  "rfp",
  "evaluating",
  "needs_help",
  "other",
];

export const SIGNAL_LABELS: Record<SignalType, string> = {
  seeking_partner: "Seeking Zoho partner",
  rfp: "RFP / tender",
  evaluating: "Evaluating Zoho",
  needs_help: "Needs help",
  other: "Other",
};

/** Region to scope the lead search to. */
export type Country = "czech" | "slovakia" | "international";

export const COUNTRIES: Country[] = ["czech", "slovakia", "international"];

export const COUNTRY_LABELS: Record<Country, string> = {
  czech: "Czech Republic",
  slovakia: "Slovakia",
  international: "International",
};

/** Preset windows for how recent a result must be. */
export type TimePreset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "any"
  | "custom";

export const TIME_PRESET_LABELS: Record<TimePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Past week",
  month: "Past month",
  year: "Past year",
  any: "Any time",
  custom: "Custom range",
};

/** The recency window selected by the user for a search run. */
export interface TimeRange {
  preset: TimePreset;
  /** ISO yyyy-mm-dd, only used when preset === "custom". */
  from?: string;
  to?: string;
}

/** A search query the agent runs against the web via Gemini. */
export interface SearchQuery {
  id: string;
  /** Natural-language instruction describing what to look for. */
  prompt: string;
  enabled: boolean;
  createdAt: string;
}

/** A single discovered lead, extracted from a grounded search result. */
export interface Lead {
  id: string;
  /** Company or organization the signal is about. */
  company: string;
  signalType: SignalType;
  /** Which Zoho product(s) are mentioned, if any. */
  products: string[];
  /** Short human-readable summary of the finding. */
  summary: string;
  /** Source URL the claim is grounded in. */
  sourceUrl: string;
  /** Source title/domain for display. */
  sourceTitle: string;
  /** Model's confidence 0-1 that this is a genuine, relevant signal. */
  confidence: number;
  /** Approximate date of the source content, if known (ISO or free text). */
  publishedAt?: string;
  /** id of the SearchQuery that produced this lead. */
  queryId: string;
  /** When this agent discovered it. */
  discoveredAt: string;
  /** Workflow status set by the user. */
  status: "new" | "reviewed" | "dismissed";
}

/** Result of a single agent run across all enabled queries. */
export interface RunResult {
  startedAt: string;
  finishedAt: string;
  queriesRun: number;
  found: number; // total candidates returned by the model
  errors: string[];
  /** Discovered leads (filtered + deduped within this run). The client merges
   * these into its localStorage store and decides which are actually new. */
  leads: Lead[];
}

// ---- Directory (Vizitka.ai catalog) ----

/**
 * A business profile scraped from the Vizitka.ai catalog. Unlike a `Lead`
 * (model-inferred from web search), these are deterministic records read from
 * each profile's JSON-LD, so the contact details are exactly what the site
 * publishes.
 */
export interface DirectoryRecord {
  /** Stable id: the profile's numeric id on vizitka.ai, e.g. "vizitka-3". */
  id: string;
  /** Canonical profile URL on vizitka.ai. */
  detailUrl: string;
  /** Headline of the profile — usually the service offered, not the company. */
  title: string;
  /** Legal/company name (JSON-LD legalName, falling back to name). */
  company: string;
  description: string;
  email?: string;
  /** Normalized to +420 xxx xxx xxx where possible. */
  phone?: string;
  website?: string;
  /** Street/locality from the profile's PostalAddress. */
  address?: string;
  /** ISO-2 country code from the profile's PostalAddress, e.g. "CZ". */
  country?: string;
  /** Region the business serves, e.g. "Celá ČR" or "Praha". */
  areaServed?: string;
  logo?: string;
  /** Named services from the profile's makesOffer list. */
  services: string[];
  /** When this record was scraped. */
  fetchedAt: string;
}

/** Outcome of pushing one record/lead into Zoho CRM. */
export interface ZohoPushResult {
  /** Our local id for the thing we pushed (DirectoryRecord.id or Lead.id). */
  id: string;
  status: "created" | "duplicate" | "error";
  /** Zoho's record id when created. */
  zohoId?: string;
  /** Zoho's message, or the local error. */
  message: string;
}
