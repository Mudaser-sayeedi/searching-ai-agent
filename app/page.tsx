"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import {
  SIGNAL_LABELS,
  SIGNAL_TYPES,
  TIME_PRESET_LABELS,
  type Lead,
  type RunResult,
  type SearchQuery,
  type SignalType,
  type TimePreset,
  type TimeRange,
} from "@/lib/types";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { QueriesPanel } from "./QueriesPanel";

type StatusFilter = "all" | Lead["status"];

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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [queries, setQueries] = useState<SearchQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recency window for the next search run (default: today).
  const [preset, setPreset] = useState<TimePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Filters applied to the stored leads list.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<SignalType | "all">("all");
  const [search, setSearch] = useState("");

  const loadLeads = useCallback(async () => {
    const res = await fetch("/api/leads");
    const data = await res.json();
    setLeads(data.leads ?? []);
  }, []);

  const loadQueries = useCallback(async () => {
    const res = await fetch("/api/queries");
    const data = await res.json();
    setQueries(data.queries ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.all([loadLeads(), loadQueries()]);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadLeads, loadQueries]);

  const runSearch = useCallback(async () => {
    setRunning(true);
    setError(null);
    const timeRange: TimeRange = {
      preset,
      from: preset === "custom" ? customFrom || undefined : undefined,
      to: preset === "custom" ? customTo || undefined : undefined,
    };
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeRange }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setLastRun(data as RunResult);
      if (data.errors?.length) setError(data.errors.join(" | "));
      await loadLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [preset, customFrom, customTo, loadLeads]);

  const setLeadStatus = useCallback(
    async (id: string, status: Lead["status"]) => {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
    },
    [],
  );

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
            {counts.total} leads · {counts.new} new
            {lastRun && (
              <>
                {" · last run added "}
                <strong className="text-foreground">{lastRun.added}</strong>
                {` of ${lastRun.found} found`}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/export" download>
              <Download /> Export CSV
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Search control bar */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
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

          <Button onClick={runSearch} disabled={running} className="sm:ml-auto">
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

      <QueriesPanel queries={queries} onChange={loadQueries} />

      {/* Filters */}
      <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-50">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, product, text…"
            className="pl-9"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as SignalType | "all")}
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
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
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
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {filtered.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onStatus={setLeadStatus} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </main>
  );
}

function LeadCard({
  lead,
  onStatus,
}: {
  lead: Lead;
  onStatus: (id: string, status: Lead["status"]) => void;
}) {
  const dimmed = lead.status === "dismissed";
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
            <Badge>{SIGNAL_LABELS[lead.signalType]}</Badge>
            {lead.status === "new" && <Badge variant="success">new</Badge>}
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

            <span className="ml-auto flex gap-2">
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
