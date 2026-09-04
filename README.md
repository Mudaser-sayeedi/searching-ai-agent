# Zoho Signal Monitor

A lead-prospecting dashboard with **two sources**, and one-click **push into
Zoho CRM** as a Lead from either of them.

| Tab | Source | Nature of the data |
| --- | --- | --- |
| **Web search** | Google Gemini with Google Search grounding | Model-discovered buying signals — broad reach, variable quality |
| **Vizitka.ai catalog** | [vizitka.ai/katalog-vizitek](https://www.vizitka.ai/katalog-vizitek/) | Deterministic company profiles with real contact details |

Both tabs share the same Zoho CRM integration, and neither can create the same
lead twice — see **Duplicate protection** below.

## The Vizitka.ai catalog tab

Every profile page on vizitka.ai embeds a JSON-LD `@graph` (an `Organization`
plus a `LocalBusiness` node). The scraper reads *that*, not the rendered
markup — so company name, e-mail, phone, website, address, area served and the
list of services are exactly what the site publishes. Nothing is inferred by a
model, and the extraction does not break when the site restyles its pages.

- Listing pages are walked to collect every profile; each profile is fetched
  with a small concurrency limit and retried once on failure.
- Results are cached for 12 hours (`data/vizitka-catalog.json`); **Refresh from
  site** forces a re-scrape.
- If a profile can't be read on a refresh, the previously-loaded copy is kept
  and the UI names what was missed — a transient blip never silently loses a
  lead.
- `robots.txt` on vizitka.ai allows crawling; requests are sent with an
  identifying User-Agent.

Both lists — catalog profiles and web-search leads — are paginated 10 per page.
Searching or filtering returns you to page one, and the bulk **Add N to Zoho
CRM** button acts on everything matching the current filter, not just the page
on screen.

## Zoho CRM setup

Create a **Self Client** in the Zoho API console for your data centre
(EU: <https://api-console.zoho.eu>) and generate a refresh token with scope:

```
ZohoCRM.modules.leads.ALL,ZohoSearch.securesearch.READ
```

Then fill these into `.env` and restart the dev server:

```ini
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...

# Data centre — defaults are EU. US: accounts.zoho.com + www.zohoapis.com
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.eu
ZOHO_API_DOMAIN=https://www.zohoapis.eu

# Written to Lead_Source. If it isn't in your picklist the app retries
# without it rather than failing the insert.
ZOHO_LEAD_SOURCE=Vizitka.ai
```

Until these are set the CRM buttons are disabled and the UI says so, rather
than failing on click.

### Field mapping (catalog profile → Zoho Lead)

| Zoho field | Source |
| --- | --- |
| `Last_Name`, `Company` | Legal company name (`Last_Name` is Zoho-mandatory; these profiles have no named contact) |
| `Email`, `Phone`, `Website` | Profile contact details |
| `City`, `Country` | Profile `PostalAddress` |
| `Description` | Headline, description, service list, area served, and the source profile URL |
| `Lead_Source` | `ZOHO_LEAD_SOURCE` |

### Duplicate protection

A record that has already been created is never created again, and comes back
marked **In CRM** — including in a browser that has never seen it:

1. **Before every insert**, the server searches Zoho for an existing Lead by
   e-mail (and by exact company name when there's no e-mail). Matches are
   reported as duplicates and skipped.
2. Zoho's own `DUPLICATE_DATA` verdict is treated as "already there", not as an
   error.
3. On load, each tab asks `/api/zoho/check` which of its records already exist
   in CRM, so the badge is correct after a cache clear or on a new machine.
4. The browser also caches the answer in `localStorage` for an instant render.
   That is only a display cache — **CRM is the source of truth**, so clearing
   site data cannot produce duplicates.

### Workflows

Leads are created with `trigger: ["workflow"]`, so your **workflow rules fire
exactly as they would for a lead entered by hand** — assignment rules,
notification e-mails, follow-up tasks and field updates all apply.

Note this also applies to the bulk **Add N to Zoho CRM** button: pushing 30
profiles fires the workflows 30 times. Records already in CRM are skipped
before the insert, so re-running a push never re-fires them.

Change it with `ZOHO_TRIGGERS` in `.env`:

```ini
ZOHO_TRIGGERS=workflow            # default
ZOHO_TRIGGERS=workflow,blueprint  # also start blueprints
ZOHO_TRIGGERS=none                # insert silently (one-off bulk backfill)
```

Allowed values are `workflow`, `approval` and `blueprint`. An unrecognised
value falls back to `workflow` rather than silently disabling automations.

## How the web-search tab works

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
  page.tsx            Dashboard shell: source tabs, web-search view, lead cards
  CatalogPanel.tsx    Vizitka.ai catalog view + push to CRM
  QueriesPanel.tsx    Manage monitoring queries
  useCrm.ts           Shared CRM state: what's already in CRM, push, re-check
  api/
    search/route.ts   Trigger an agent run (POST; GET for cron) with a time range
    queries/route.ts  The seeded default monitoring queries (read-only)
    catalog/route.ts  Vizitka.ai profiles (?refresh=1 to re-scrape)
    zoho/status       Whether Zoho credentials are configured
    zoho/check        Which records already exist as Leads in CRM
    zoho/push         Create Leads (skipping anything already in CRM)
lib/
  gemini.ts           Two-step Gemini agent: grounded research + extraction
  agent.ts            Run orchestration (search -> filter -> dedupe)
  vizitka.ts          Catalog scraper (JSON-LD) + 12h disk cache
  zoho.ts             Zoho CRM client: token refresh, lead lookup, insert
  crm-client.ts       Browser cache of what's already in CRM
  store.ts            JSON file storage for the default queries
  time.ts             Time-window resolution + date filtering
  types.ts            Shared domain types
components/ui/         shadcn-style UI primitives + theme toggle
data/                 Default queries + the scraped catalog cache
```

## Setup

1. Edit `.env` and set `GEMINI_API_KEY` — get a free key at
   <https://aistudio.google.com/apikey>. This powers the **Web search** tab only;
   the catalog tab needs no key.
2. Optionally fill in the `ZOHO_*` variables (see **Zoho CRM setup** above) to
   enable creating leads in CRM.
3. Install and run:
   ```powershell
   npm install
   npm run dev
   ```
4. Open <http://localhost:3000>. The **Vizitka.ai catalog** tab works
   immediately; the **Web search** tab needs the Gemini key.

## Running it automatically (optional)

The agent runs on demand, but you can schedule it. Set `CRON_SECRET` in
`.env`, then have any scheduler hit the endpoint, e.g. Windows Task
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
