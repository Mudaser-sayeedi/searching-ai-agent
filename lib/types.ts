// Shared domain types for the Zoho monitoring agent.

/** The kind of signal a lead represents. */
export type SignalType =
  | "uses_zoho" // company states/announces they use a Zoho product
  | "requesting_services" // RFP / asking for Zoho implementation, consulting, migration help
  | "migration" // moving to (or away from) Zoho
  | "review_or_mention" // public review, news, or general mention
  | "other";

export const SIGNAL_TYPES: SignalType[] = [
  "uses_zoho",
  "requesting_services",
  "migration",
  "review_or_mention",
  "other",
];

export const SIGNAL_LABELS: Record<SignalType, string> = {
  uses_zoho: "Uses Zoho",
  requesting_services: "Requesting services",
  migration: "Migration",
  review_or_mention: "Review / mention",
  other: "Other",
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
