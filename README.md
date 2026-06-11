# Zoho Signal Monitor

An AI agent that monitors the public web for **Zoho buying & usage signals** —
companies announcing they use Zoho, businesses requesting Zoho implementation /
consulting / migration services, job posts asking for Zoho skills, and related
mentions. It uses **Google Gemini** with the built-in **Google Search grounding**
tool, so Gemini itself searches the live web and returns findings backed by real
source URLs.

## How it works

1. You define **monitoring queries** (plain-English instructions). Sensible
   defaults are seeded on first run.
2. You pick a **time window** (Today by default; also Yesterday / Past week /
   month / year / Any / custom range) and click **Run search now** (or hit
   `/api/search`). Each enabled query runs through Gemini in two steps:
   - **Research** — Gemini uses live Google Search grounding and reports its
     findings as prose, which comes back with *real* source URLs.
   - **Extraction** — a second, schema-constrained call turns those notes into
     structured leads, each referencing a real grounded source by index (so a
     lead's link can never be a URL the model invented).
3. Each **lead**: company, signal type, Zoho products, summary, **working
   source URL**, date, confidence. **Job postings, recruiters, and agencies
   selling Zoho services are filtered out** — this is for B2B buyer leads.
4. Leads are **deduplicated** and stored, shown in a filterable dashboard where
   you can mark them reviewed/dismissed, and **export to CSV**.

```
app/
  page.tsx            Dashboard (leads, filters, time window, run, export)
  QueriesPanel.tsx    Manage monitoring queries
  api/
    search/route.ts   Trigger an agent run (POST; GET for cron) with a time range
    leads/route.ts    List leads / update status
    queries/route.ts  CRUD for monitoring queries
    export/route.ts   Download all leads as CSV
lib/
  gemini.ts           Two-step Gemini agent: grounded research + extraction
  agent.ts            Run orchestration (search -> filter -> dedupe -> store)
  store.ts            JSON file storage with a write lock (data/*.json)
  time.ts             Time-window resolution + date filtering
  types.ts            Shared domain types
components/ui/         shadcn-style UI primitives + theme toggle
data/                 Local JSON store (gitignored, created on first run)
```

## Setup

1. Get a free Gemini API key: https://aistudio.google.com/apikey
2. Copy the env file and add your key:
   ```powershell
   Copy-Item .env.local.example .env.local
   # then edit .env.local and set GEMINI_API_KEY=...
   ```
3. Install and run:
   ```powershell
   npm install
   npm run dev
   ```
4. Open http://localhost:3000 and click **Run search now**.

## Running it automatically (optional)

The agent runs on demand, but you can schedule it. Set `CRON_SECRET` in
`.env.local`, then have any scheduler hit the endpoint, e.g. Windows Task
Scheduler running:

```powershell
Invoke-WebRequest "http://localhost:3000/api/search?secret=YOUR_SECRET"
```

## Scope & limits

- **Covered:** anything Google indexes — news, blogs, press releases, forums,
  job boards, and public social posts.
- **Not covered out of the box:** real-time scraping of closed platforms
  (X/Twitter, private LinkedIn) needs their paid APIs. The `lib/gemini.ts`
  module is the single place to extend with additional data sources.
- Leads are model-generated from live search; always click through to the
  source to confirm before acting on a lead.
