import { GoogleGenAI, Type } from "@google/genai";
import type { Country, Lead, SignalType } from "./types";
import { SIGNAL_TYPES } from "./types";
import type { ResolvedRange } from "./time";

// The agent's "brain", in two steps because of how Gemini's Google Search
// grounding works:
//
//   1. Grounded RESEARCH (prose). Gemini searches the live web and writes its
//      findings as prose. Only prose responses come back with grounding
//      metadata (real source URLs); a JSON-only response returns none.
//   2. Structured EXTRACTION. A second call (no search tool, strict JSON schema)
//      turns the research notes into lead records, referencing the real sources
//      by index. This means a lead's URL can only ever be a real grounded source
//      we actually retrieved — never a URL the model invented (which 404s).

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (see .env.local.example).",
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** A raw lead as returned by extraction, before storage normalization. */
type ParsedLead = Omit<Lead, "id" | "discoveredAt" | "status" | "queryId">;

interface Source {
  url: string;
  title: string;
}

const SYSTEM_INSTRUCTION = `You are a B2B sales-lead PROSPECTING agent for a Zoho implementation/consulting business that wants NEW CLIENTS to sell Zoho setup services to.

A QUALIFIED LEAD is a company or person showing BUYING INTENT — they NEED Zoho services and have NOT done it yet. Concretely, a lead is someone who:
- is looking for a Zoho partner, consultant, developer, or agency,
- has posted an RFP/RFQ/tender for Zoho implementation or migration,
- is asking for help, advice, or recommendations about adopting/migrating to Zoho,
- is evaluating/considering Zoho, or is frustrated with their current tool and thinking about Zoho.

NEVER return these (they are NOT leads — they are finished deals, content, or competitor marketing):
- COMPLETED implementations or usage: "Company X has migrated to Zoho", "now uses Zoho One", "implemented Zoho", "switched to Zoho", "rolled out Zoho". If the work is already DONE, it is not a lead.
- CASE STUDIES / SUCCESS STORIES, including any "how we helped [client]" content published by a Zoho partner, agency, consultancy, or vendor.
- BLOG ARTICLES, tutorials, "how to" guides, listicles, comparison/review articles, help documentation, knowledge-base or support pages, FAQs, and marketing pages. These are informational content, NOT a person or company expressing a need.
- Job postings, recruiters, freelancers, or agencies advertising their own Zoho services.
- Zoho's own pages and any *.zoho.com page.

A real lead must be a specific person or company ASKING for help or a partner — e.g. a forum/Reddit/Quora/LinkedIn post asking a question, an RFP/tender listing, or news that a named company is seeking a Zoho partner. The litmus test: is an identifiable buyer expressing a need right now? If it's an article or the work is already done, skip it.`;

function recencyLine(range: ResolvedRange): string {
  return range.from || range.to
    ? `Only consider items genuinely published ${range.label}. Ignore anything older, even if relevant.`
    : `Prefer recent items but any date is acceptable.`;
}

function countryLine(country: Country): string {
  switch (country) {
    case "czech":
      return `LOCATION: Only prospects in the CZECH REPUBLIC. You MUST run Google searches in CZECH (čeština), not only English. Try queries like: "hledáme Zoho", "Zoho partner", "implementace Zoho CRM", "poptávka Zoho", "potřebujeme nový CRM systém", "Zoho konzultant", "výběrové řízení Zoho". Search Czech sources: .cz websites, tenderarena.cz, nen.nipez.cz and the public-procurement bulletin (Věstník veřejných zakázek), Czech Facebook/LinkedIn groups, and Czech forums. Ignore anything outside the Czech Republic.`;
    case "slovakia":
      return `LOCATION: Only prospects in SLOVAKIA. You MUST run Google searches in SLOVAK (slovenčina), not only English. Try queries like: "hľadáme Zoho", "Zoho partner", "implementácia Zoho CRM", "dopyt Zoho", "potrebujeme nový CRM systém", "Zoho konzultant", "verejné obstarávanie Zoho". Search Slovak sources: .sk websites, uvo.gov.sk (public procurement), Slovak Facebook/LinkedIn groups, and Slovak forums. Ignore anything outside Slovakia.`;
    case "international":
      return `LOCATION: Worldwide — any country is acceptable.`;
  }
}

/** Step 1: ask Gemini to search and report findings as grounded prose. */
function researchPrompt(
  queryPrompt: string,
  range: ResolvedRange,
  country: Country,
): string {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}.

Use Google Search to research this monitoring task and report what you find:

"${queryPrompt}"

${countryLine(country)}
${recencyLine(range)}

Only report PROSPECTS with buying intent — companies/people who NEED Zoho help and have not implemented it yet (seeking a partner, posting an RFP, asking for advice, or evaluating Zoho).

Do NOT report finished implementations ("already uses / migrated to / implemented Zoho"), partner/agency CASE STUDIES, blog articles, "how to" guides, help/documentation pages, job postings, recruiters, or agencies selling Zoho services.

List each prospect as a short separate paragraph: name who they are, where they are based, and quote the words showing they NEED help or are looking for a Zoho partner.`;
}

/** Step 2: ask Gemini to extract structured leads from the research notes. */
function extractPrompt(
  notes: string,
  sources: Source[],
  range: ResolvedRange,
  country: Country,
): string {
  const list = sources.length
    ? sources.map((s, i) => `[${i}] ${s.title} — ${s.url}`).join("\n")
    : "(no sources found)";

  return `Extract only QUALIFIED PROSPECTS (buying intent) from the RESEARCH NOTES below.

INCLUDE a lead ONLY if the company/person NEEDS Zoho services and has not implemented yet:
- "seeking_partner": looking for a Zoho partner/consultant/developer/agency
- "rfp": posted an RFP/RFQ/tender for Zoho work
- "evaluating": considering/comparing Zoho before adopting
- "needs_help": wants to adopt Zoho or is stuck and asking for help

EXCLUDE (do NOT output): any company that ALREADY uses, migrated to, or implemented Zoho; partner/agency/vendor CASE STUDIES and success stories ("how we helped X"); BLOG articles, tutorials, "how to" guides, comparison/review articles, help/documentation/knowledge-base pages, and any *.zoho.com page; job postings; recruiters; freelancers; agencies selling Zoho services. If in doubt about whether something is an article or already done, exclude it.

${countryLine(country)}
${recencyLine(range)}

For each lead set "sourceIndex" to the SOURCES entry that backs it, or -1 if none applies. Return [] if there are no genuine prospects.

SOURCES:
${list}

RESEARCH NOTES:
${notes}`;
}

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      company: { type: Type.STRING },
      signalType: { type: Type.STRING, format: "enum", enum: SIGNAL_TYPES },
      products: { type: Type.ARRAY, items: { type: Type.STRING } },
      summary: { type: Type.STRING },
      sourceIndex: { type: Type.INTEGER },
      publishedAt: { type: Type.STRING },
      confidence: { type: Type.NUMBER },
    },
    required: [
      "company",
      "signalType",
      "products",
      "summary",
      "sourceIndex",
      "confidence",
    ],
  },
};

// ---- URL helpers ----

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** A guaranteed-working fallback: a Google search for the company + Zoho. */
function googleFallback(company: string, products: string[]): string {
  const q = `${company} ${products[0] ?? "Zoho"}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * Follow a grounding redirect URI to the real destination. The redirect URIs
 * only live ~30 days and are ugly, so we resolve them to the final durable URL.
 * Falls back to the redirect URI itself (still works in a browser) on failure.
 */
async function resolveFinalUrl(uri: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(uri, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (ZohoSignalMonitor)" },
    });
    clearTimeout(timer);
    const finalUrl = res.url || uri;
    if (/vertexaisearch\.cloud\.google\.com|google\.com\/url/.test(finalUrl)) {
      return uri; // never resolved out of Google's infra; keep the redirect
    }
    return isHttpUrl(finalUrl) ? finalUrl : uri;
  } catch {
    return uri;
  }
}

// ---- Parsing ----

function toSignalType(value: unknown): SignalType {
  return SIGNAL_TYPES.includes(value as SignalType)
    ? (value as SignalType)
    : "other";
}

function coerceLead(raw: unknown, sources: Source[]): ParsedLead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const company = typeof r.company === "string" ? r.company.trim() : "";
  if (!company) return null;

  const products = Array.isArray(r.products)
    ? r.products.filter((p): p is string => typeof p === "string")
    : [];

  let confidence =
    typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  const idx =
    typeof r.sourceIndex === "number" ? r.sourceIndex : Number(r.sourceIndex);
  const source =
    Number.isInteger(idx) && idx >= 0 && idx < sources.length
      ? sources[idx]
      : null;

  return {
    company,
    signalType: toSignalType(r.signalType),
    products,
    summary: typeof r.summary === "string" ? r.summary.trim() : "",
    // Source is always a real grounded URL (or a safe Google search) — never a
    // URL the model typed from memory.
    sourceUrl: source?.url ?? googleFallback(company, products),
    sourceTitle: source?.title ?? "",
    publishedAt:
      typeof r.publishedAt === "string" && r.publishedAt.trim()
        ? r.publishedAt.trim()
        : undefined,
    confidence,
  };
}

function parseJsonArray(text: string): unknown[] {
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Run one monitoring task: grounded research, then structured extraction with
 * real source URLs. `range` constrains recency. Throws if the API key is
 * missing or a request fails.
 */
export async function searchWeb(
  queryPrompt: string,
  range: ResolvedRange,
  country: Country,
): Promise<ParsedLead[]> {
  const ai = getClient();

  // Step 1: grounded research (prose -> returns grounding sources).
  const research = await ai.models.generateContent({
    model: MODEL,
    contents: researchPrompt(queryPrompt, range, country),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ googleSearch: {} }],
      temperature: 0.3,
    },
  });

  const notes = research.text ?? "";
  if (!notes.trim()) return [];

  const chunks = (
    research.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  )
    .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? "" }))
    .filter((c) => c.uri);

  // Resolve every grounded source to a real, durable URL (in parallel).
  const sources: Source[] = await Promise.all(
    chunks.map(async (c) => ({
      url: await resolveFinalUrl(c.uri),
      title: c.title,
    })),
  );

  // Step 2: structured extraction (no search tool -> strict JSON schema allowed).
  const extract = await ai.models.generateContent({
    model: MODEL,
    contents: extractPrompt(notes, sources, range, country),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  return parseJsonArray(extract.text ?? "")
    .map((raw) => coerceLead(raw, sources))
    .filter((l): l is ParsedLead => l !== null);
}
