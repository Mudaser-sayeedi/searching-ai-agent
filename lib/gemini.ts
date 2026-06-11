import { GoogleGenAI, Type } from "@google/genai";
import type { Lead, SignalType } from "./types";
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

const SYSTEM_INSTRUCTION = `You are a B2B sales-lead research agent for a Zoho consulting/services business.
You monitor the public web for COMPANIES that already use Zoho products or are looking to buy Zoho implementation/consulting services. Zoho products include Zoho CRM, Zoho One, Zoho Books, Zoho Creator, Zoho Desk, Zoho People, etc.

CRITICAL EXCLUSIONS — never treat these as leads:
- Job postings, hiring ads, recruitment/careers listings ("Zoho CRM Developer wanted"). We sell to companies, not job seekers.
- Individual freelancers, contractors, or agencies advertising that THEY offer Zoho services.
- Zoho's own marketing pages and generic "what is Zoho" / tutorial articles.
- Anything with no identifiable buying company/organization.

A good lead is a company (the customer/buyer) that states it uses Zoho, is migrating to Zoho, or is asking for help/partners to implement Zoho.`;

function recencyLine(range: ResolvedRange): string {
  return range.from || range.to
    ? `Only consider items genuinely published ${range.label}. Ignore anything older, even if relevant.`
    : `Prefer recent items but any date is acceptable.`;
}

/** Step 1: ask Gemini to search and report findings as grounded prose. */
function researchPrompt(queryPrompt: string, range: ResolvedRange): string {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}.

Use Google Search to research this monitoring task and report what you find:

"${queryPrompt}"

${recencyLine(range)}

List every specific company you find as a short separate paragraph. Name the company and describe the Zoho signal (uses Zoho / migrating to Zoho / seeking a Zoho partner). Do NOT include job postings, recruiters, or agencies selling Zoho services.`;
}

/** Step 2: ask Gemini to extract structured leads from the research notes. */
function extractPrompt(
  notes: string,
  sources: Source[],
  range: ResolvedRange,
): string {
  const list = sources.length
    ? sources.map((s, i) => `[${i}] ${s.title} — ${s.url}`).join("\n")
    : "(no sources found)";

  return `Extract qualifying B2B Zoho sales leads from the RESEARCH NOTES below.

A lead is a COMPANY that uses, is migrating to, or is seeking help to implement Zoho.
EXCLUDE job postings, recruiters, freelancers, and agencies selling Zoho services.
${recencyLine(range)}

For each lead set "sourceIndex" to the SOURCES entry that backs it, or -1 if none applies.

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
): Promise<ParsedLead[]> {
  const ai = getClient();

  // Step 1: grounded research (prose -> returns grounding sources).
  const research = await ai.models.generateContent({
    model: MODEL,
    contents: researchPrompt(queryPrompt, range),
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
    contents: extractPrompt(notes, sources, range),
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
