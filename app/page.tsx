"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookUser,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  COUNTRIES,
  COUNTRY_LABELS,
  SIGNAL_LABELS,
  SIGNAL_TYPES,
  TIME_PRESET_LABELS,
  type Country,
  type Lead,
  type SearchQuery,
  type SignalType,
  type TimePreset,
  type TimeRange,
} from "@/lib/types";
import {
  clearLeads,
  downloadLeadsCsv,
  loadLeads,
  mergeLeads,
  saveLeads,
} from "@/lib/leads-client";
import {
  getEffectiveQueries,
  type EffectiveQuery,
} from "@/lib/queries-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { crmLeadUrl, type CrmLinks } from "@/lib/crm-client";
import { paginate } from "@/lib/paginate";
import { Pagination } from "@/components/ui/pagination";
import { ThemeToggle } from "@/components/theme-toggle";
import { QueriesPanel } from "./QueriesPanel";
import { CatalogPanel } from "./CatalogPanel";
import { useCrm } from "./useCrm";

type StatusFilter = "all" | Lead["status"];

/** Which data source the dashboard is showing. */
type Tab = "search" | "catalog";

/** Leads per page. */
const PAGE_SIZE = 10;

const TIME_PRESETS: TimePreset[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "any",
  "custom",
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("search");
  // Zoho CRM state is shared by both tabs, so something pushed from one shows
  // as "In CRM" in the other.
  const crm = useCrm();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [queries, setQueries] = useState<EffectiveQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<{
    found: number;
    added: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recency window for the next search run (default: today).
  const [preset, setPreset] = useState<TimePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Region to scope the search to (default: Czech Republic).
  const [country, setCountry] = useState<Country>("international");

  // Filters applied to the stored leads list.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<SignalType | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  /** Top of the leads list, so paging keeps the first row in view. */
  const listTopRef = useRef<HTMLDivElement>(null);

  // Always-current views so callbacks read the latest without re-binding.
  const leadsRef = useRef<Lead[]>([]);
  useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);
  const queriesRef = useRef<EffectiveQuery[]>([]);
  useEffect(() => {
    queriesRef.current = queries;
  }, [queries]);

  // Server default queries (read-only); the effective list combines these with
  // the user's custom queries + on/off overrides from localStorage.
  const defaultsRef = useRef<SearchQuery[]>([]);

  // Recompute the effective query list from cached defaults + localStorage.
  const refreshQueries = useCallback(() => {
    setQueries(getEffectiveQueries(defaultsRef.current));
  }, []);

  const loadQueries = useCallback(async () => {
    const res = await fetch("/api/queries");
    const data = await res.json();
    defaultsRef.current = data.queries ?? [];
    setQueries(getEffectiveQueries(defaultsRef.current));
  }, []);

  useEffect(() => {
    // Leads + custom queries live in the browser (localStorage); default
    // queries come from the server.
    setLeads(loadLeads());
    let active = true;
    loadQueries().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadQueries]);

  // Reconcile stored leads against Zoho CRM, so a lead pushed in an earlier
  // session is still shown as "In CRM" here (and never pushed twice).
  const { status: crmStatus, check: crmCheck } = crm;
  const checkedLeadsRef = useRef("");
  useEffect(() => {
    if (!crmStatus?.configured || leads.length === 0) return;
    const signature = leads.map((l) => l.id).join(",");
    if (checkedLeadsRef.current === signature) return;
    checkedLeadsRef.current = signature;
    crmCheck(leads.map((l) => ({ id: l.id, company: l.company })));
  }, [leads, crmStatus?.configured, crmCheck]);

  const runSearch = useCallback(async () => {
    setRunning(true);
    setError(null);
    const timeRange: TimeRange = {
      preset,
      from: preset === "custom" ? customFrom || undefined : undefined,
      to: preset === "custom" ? customTo || undefined : undefined,
    };
    const queries = queriesRef.current
      .filter((q) => q.enabled)
      .map((q) => q.prompt);
    if (queries.length === 0) {
      setError("No active queries. Enable or add at least one query to search.");
      setRunning(false);
      return;
    }
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeRange, queries, country }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");

      const incoming: Lead[] = data.leads ?? [];
      const { merged, added } = mergeLeads(leadsRef.current, incoming);
      setLeads(merged);
      saveLeads(merged);
      setRunSummary({ found: data.found ?? incoming.length, added });
      if (data.errors?.length) setError(data.errors.join(" | "));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [preset, customFrom, customTo, country]);

  const setLeadStatus = useCallback((id: string, status: Lead["status"]) => {
    const next = leadsRef.current.map((l) =>
      l.id === id ? { ...l, status } : l,
    );
    setLeads(next);
    saveLeads(next);
  }, []);

  const clearAll = useCallback(() => {
    if (
      !window.confirm(
        "Clear all saved leads from this browser? This cannot be undone.",
      )
    )
      return;
    clearLeads();
    setLeads([]);
    setRunSummary(null);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (typeFilter !== "all" && l.signalType !== typeFilter) return false;
      if (q) {
        const hay =
          `${l.company} ${l.summary} ${l.products.join(" ")} ${l.sourceTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, statusFilter, typeFilter, search]);

  const pageData = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  const goToPage = useCallback((next: number) => {
    setPage(next);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const counts = useMemo(
    () => ({
      total: leads.length,
      new: leads.filter((l) => l.status === "new").length,
    }),
    [leads],
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Zoho Signal Monitor
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "search" ? (
              <>
                {counts.total} leads · {counts.new} new · saved in this browser
                {runSummary && (
                  <>
                    {" · last run added "}
                    <strong className="text-foreground">
                      {runSummary.added}
                    </strong>
                    {` of ${runSummary.found} found`}
                  </>
                )}
              </>
            ) : (
              "Business profiles from the Vizitka.ai catalog, ready to push into Zoho CRM"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "search" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadLeadsCsv(leads)}
                disabled={leads.length === 0}
              >
                <Download /> Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                disabled={leads.length === 0}
              >
                <Trash2 /> Clear
              </Button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* Source tabs */}
      <div className="mb-4 inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
        <TabButton active={tab === "search"} onClick={() => setTab("search")}>
          <Sparkles className="h-4 w-4" /> Web search
        </TabButton>
        <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>
          <BookUser className="h-4 w-4" /> Vizitka.ai catalog
        </TabButton>
      </div>

      {/* Anything that went wrong talking to Zoho, on either tab */}
      <AnimatePresence>
        {crm.error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="flex-1">{crm.error}</span>
            <button
              onClick={crm.clearError}
              className="shrink-0 underline underline-offset-2"
            >
              dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === "catalog" ? (
        <CatalogPanel crm={crm} />
      ) : (
        <>
          {/* Search control bar */}
          <Card className="mb-4">
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Region
                </label>
                <Select
                  value={country}
                  onValueChange={(v) => setCountry(v as Country)}
                >
                  <SelectTrigger className="w-full sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {COUNTRY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Show posts from
                </label>
                <Select
                  value={preset}
                  onValueChange={(v) => setPreset(v as TimePreset)}
                >
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {TIME_PRESET_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <AnimatePresence initial={false}>
                {preset === "custom" && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="flex items-end gap-2 overflow-hidden"
                  >
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        From
                      </label>
                      <Input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="w-40"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        To
                      </label>
                      <Input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="w-40"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                onClick={runSearch}
                disabled={running}
                className="sm:ml-auto"
              >
                {running ? (
                  <>
                    <Loader2 className="animate-spin" /> Searching the web…
                  </>
                ) : (
                  <>
                    <RefreshCw /> Run search now
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Errors */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <QueriesPanel queries={queries} onChange={refreshQueries} />

          {/* Filters — narrowing the list always returns to the first page */}
          <div
            ref={listTopRef}
            className="mb-4 mt-6 flex flex-wrap items-center gap-2"
          >
            <div className="relative flex-1 min-w-50">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search company, product, text…"
                className="pl-9"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v as SignalType | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All signal types</SelectItem>
                {SIGNAL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {SIGNAL_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as StatusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Leads */}
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {leads.length === 0
                ? 'No leads yet. Pick a time window and click "Run search now".'
                : "No leads match your filters."}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                <AnimatePresence initial={false}>
                  {pageData.items.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onStatus={setLeadStatus}
                      link={crm.links[lead.id]}
                      crmBaseUrl={crm.status?.crmBaseUrl ?? ""}
                      busy={crm.pending.includes(lead.id)}
                      canPush={Boolean(crm.status?.configured)}
                      onPush={() => crm.push({ leads: [lead] })}
                    />
                  ))}
                </AnimatePresence>
              </ul>

              <Pagination
                page={pageData.page}
                pageCount={pageData.pageCount}
                from={pageData.from}
                to={pageData.to}
                total={pageData.total}
                noun="leads"
                onPageChange={goToPage}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function LeadCard({
  lead,
  onStatus,
  link,
  crmBaseUrl,
  busy,
  canPush,
  onPush,
}: {
  lead: Lead;
  onStatus: (id: string, status: Lead["status"]) => void;
  link: CrmLinks[string] | undefined;
  crmBaseUrl: string;
  busy: boolean;
  canPush: boolean;
  onPush: () => void;
}) {
  const dimmed = lead.status === "dismissed";
  const inCrm = Boolean(link);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: dimmed ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="transition-shadow hover:shadow-md">
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {lead.company || "Unknown company"}
            </span>
            <Badge>{SIGNAL_LABELS[lead.signalType] ?? lead.signalType}</Badge>
            {lead.status === "new" && <Badge variant="success">new</Badge>}
            {inCrm && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> In CRM
              </Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {Math.round(lead.confidence * 100)}% confidence
            </span>
          </div>

          {lead.products.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {lead.products.join(", ")}
            </p>
          )}

          <p className="mt-2 text-sm">{lead.summary}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {lead.sourceUrl ? (
              <a
                href={lead.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                {lead.sourceTitle || "View source"}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span>No source URL</span>
            )}
            {lead.publishedAt && <span>published {lead.publishedAt}</span>}
            <span>found {new Date(lead.discoveredAt).toLocaleDateString()}</span>

            <span className="ml-auto flex flex-wrap items-center gap-2">
              {inCrm ? (
                link!.zohoId && crmBaseUrl ? (
                  <Button variant="outline" size="xs" asChild>
                    <a
                      href={crmLeadUrl(crmBaseUrl, link!.zohoId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in CRM <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                ) : null
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={onPush}
                  disabled={busy || !canPush}
                  title={
                    canPush ? undefined : "Set your Zoho credentials in .env first"
                  }
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Adding…
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-3 w-3" /> Add to Zoho CRM
                    </>
                  )}
                </Button>
              )}
              {lead.status !== "reviewed" && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onStatus(lead.id, "reviewed")}
                >
                  Mark reviewed
                </Button>
              )}
              {lead.status !== "dismissed" ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onStatus(lead.id, "dismissed")}
                >
                  Dismiss
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onStatus(lead.id, "new")}
                >
                  Restore
                </Button>
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.li>
  );
}
