"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  UserPlus,
} from "lucide-react";
import type { DirectoryRecord } from "@/lib/types";
import { crmLeadUrl, type CrmLinks } from "@/lib/crm-client";
import { paginate } from "@/lib/paginate";
import { Pagination } from "@/components/ui/pagination";
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
import type { useCrm } from "./useCrm";

type CrmFilter = "all" | "not_in_crm" | "in_crm";

/** Profiles per page. */
const PAGE_SIZE = 10;

/**
 * Browse the Vizitka.ai business catalog and push profiles into Zoho CRM as
 * Leads. Profiles are read from each page's structured data, so the contact
 * details shown here are exactly what the site publishes — no model inference.
 */
export function CatalogPanel({ crm }: { crm: ReturnType<typeof useCrm> }) {
  const { links, status, pending, push, check } = crm;

  const [records, setRecords] = useState<DirectoryRecord[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Profiles the site refused to serve on the last refresh. */
  const [skipped, setSkipped] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [crmFilter, setCrmFilter] = useState<CrmFilter>("all");
  const [page, setPage] = useState(1);

  // Reconcile against CRM once per set of loaded records, not on every render.
  const checkedRef = useRef<string>("");
  /** Top of the list, so paging keeps the first row in view. */
  const listTopRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/catalog${refresh ? "?refresh=1" : ""}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load the catalog");
        setRecords(data.records ?? []);
        setFetchedAt(data.fetchedAt ?? null);
        setSkipped(Array.isArray(data.skipped) ? data.skipped : []);
        setPage(1);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Fetching the catalog on mount is exactly the external-system sync effects
    // are for; the rule only fires because `load` flips a loading flag first.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, [load]);

  // Ask Zoho which of these profiles are already leads, so previously-created
  // ones show as "In CRM" even in a browser that has never pushed them.
  useEffect(() => {
    if (!status?.configured || records.length === 0) return;
    const signature = records.map((r) => r.id).join(",");
    if (checkedRef.current === signature) return;
    checkedRef.current = signature;
    check(
      records.map((r) => ({ id: r.id, company: r.company, email: r.email })),
    );
  }, [records, status?.configured, check]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const inCrm = Boolean(links[r.id]);
      if (crmFilter === "in_crm" && !inCrm) return false;
      if (crmFilter === "not_in_crm" && inCrm) return false;
      if (q) {
        const hay =
          `${r.company} ${r.title} ${r.description} ${r.areaServed ?? ""} ${r.email ?? ""} ${r.services.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, links, crmFilter, search]);

  const pageData = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  /**
   * Every profile matching the current filter that isn't in CRM yet — not just
   * this page, so "Add N" acts on what the filter selected.
   */
  const pushable = useMemo(
    () => filtered.filter((r) => !links[r.id]),
    [filtered, links],
  );

  const goToPage = useCallback((next: number) => {
    setPage(next);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const inCrmCount = useMemo(
    () => records.filter((r) => links[r.id]).length,
    [records, links],
  );

  const pushAll = useCallback(() => {
    if (pushable.length === 0) return;
    push({ records: pushable });
  }, [pushable, push]);

  return (
    <section>
      {/* Catalog controls */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Source
            </label>
            <p className="text-sm">
              <a
                href="https://www.vizitka.ai/katalog-vizitek/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Vizitka.ai — Katalog vizitek
              </a>
              <span className="ml-2 text-muted-foreground">
                {records.length} profiles
                {inCrmCount > 0 && ` · ${inCrmCount} in CRM`}
                {fetchedAt &&
                  ` · updated ${new Date(fetchedAt).toLocaleString()}`}
              </span>
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => load(true)}
            disabled={refreshing || loading}
          >
            {refreshing ? (
              <>
                <Loader2 className="animate-spin" /> Refreshing…
              </>
            ) : (
              <>
                <RefreshCw /> Refresh from site
              </>
            )}
          </Button>

          <Button
            onClick={pushAll}
            disabled={
              !status?.configured || pushable.length === 0 || pending.length > 0
            }
            title={
              status?.configured
                ? undefined
                : "Set your Zoho credentials in .env first"
            }
          >
            {pending.length > 0 ? (
              <>
                <Loader2 className="animate-spin" /> Sending…
              </>
            ) : (
              <>
                <UserPlus /> Add {pushable.length} to Zoho CRM
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Zoho not configured yet */}
      {status && !status.configured && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Zoho CRM is not connected. Add <code>ZOHO_CLIENT_ID</code>,{" "}
          <code>ZOHO_CLIENT_SECRET</code> and <code>ZOHO_REFRESH_TOKEN</code> to{" "}
          <code>.env</code>, then restart the dev server. See the README section
          “Zoho CRM setup”.
        </div>
      )}

      {loadError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {skipped.length} profile{skipped.length === 1 ? "" : "s"} could not be
          read from the site on this refresh (
          {skipped.map((id) => `#${id}`).join(", ")}). Any previously-loaded copy
          is still shown — try “Refresh from site” again later.
        </div>
      )}

      {/* Filters — narrowing the list always returns to the first page */}
      <div ref={listTopRef} className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-50 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search company, service, region…"
            className="pl-9"
          />
        </div>
        <Select
          value={crmFilter}
          onValueChange={(v) => {
            setCrmFilter(v as CrmFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All profiles</SelectItem>
            <SelectItem value="not_in_crm">Not in CRM</SelectItem>
            <SelectItem value="in_crm">Already in CRM</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Profiles */}
      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading the catalog…
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {records.length === 0
            ? "No profiles loaded. Try “Refresh from site”."
            : "No profiles match your filters."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {pageData.items.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  link={links[record.id]}
                  crmBaseUrl={status?.crmBaseUrl ?? ""}
                  busy={pending.includes(record.id)}
                  canPush={Boolean(status?.configured)}
                  onPush={() => push({ records: [record] })}
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
            noun="profiles"
            onPageChange={goToPage}
          />
        </>
      )}
    </section>
  );
}

function RecordCard({
  record,
  link,
  crmBaseUrl,
  busy,
  canPush,
  onPush,
}: {
  record: DirectoryRecord;
  link: CrmLinks[string] | undefined;
  crmBaseUrl: string;
  busy: boolean;
  canPush: boolean;
  onPush: () => void;
}) {
  const inCrm = Boolean(link);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="transition-shadow hover:shadow-md">
        <CardContent>
          <div className="flex gap-3">
            {record.logo && (
              // Remote logos from the catalog CDN; plain <img> avoids needing
              // a next/image remote-pattern allowlist for a third-party host.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={record.logo}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg border bg-white object-contain p-1"
                loading="lazy"
              />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{record.company}</span>
                {inCrm && (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> In CRM
                  </Badge>
                )}
                {record.areaServed && (
                  <Badge variant="muted">{record.areaServed}</Badge>
                )}
              </div>

              {record.title && record.title !== record.company && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {record.title}
                </p>
              )}

              {record.description && (
                <p className="mt-2 line-clamp-3 text-sm">{record.description}</p>
              )}

              {record.services.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {record.services.slice(0, 5).map((service) => (
                    <Badge key={service} variant="secondary">
                      {service}
                    </Badge>
                  ))}
                  {record.services.length > 5 && (
                    <Badge variant="muted">
                      +{record.services.length - 5} more
                    </Badge>
                  )}
                </div>
              )}

              {/* Contact details, straight from the profile's structured data */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {record.email && (
                  <a
                    href={`mailto:${record.email}`}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Mail className="h-3 w-3" /> {record.email}
                  </a>
                )}
                {record.phone && (
                  <a
                    href={`tel:${record.phone.replace(/\s/g, "")}`}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Phone className="h-3 w-3" /> {record.phone}
                  </a>
                )}
                {record.website && (
                  <a
                    href={record.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Globe className="h-3 w-3" />
                    {record.website.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                )}
                {record.address && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {record.address}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <a
                  href={record.detailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                >
                  View profile <ExternalLink className="h-3 w-3" />
                </a>

                <span className="ml-auto flex items-center gap-2">
                  {inCrm ? (
                    <>
                      <span className="text-muted-foreground">
                        Added {new Date(link!.linkedAt).toLocaleDateString()}
                      </span>
                      {link!.zohoId && crmBaseUrl && (
                        <Button variant="outline" size="xs" asChild>
                          <a
                            href={crmLeadUrl(crmBaseUrl, link!.zohoId)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open in CRM <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      size="xs"
                      onClick={onPush}
                      disabled={busy || !canPush}
                      title={
                        canPush
                          ? undefined
                          : "Set your Zoho credentials in .env first"
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
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.li>
  );
}
