"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyExisting,
  applyPushResults,
  loadCrmLinks,
  saveCrmLinks,
  type CrmLinks,
} from "@/lib/crm-client";
import type { DirectoryRecord, Lead, ZohoPushResult } from "@/lib/types";

export interface ZohoStatus {
  configured: boolean;
  leadSource: string;
  crmBaseUrl: string;
}

/** What to check for existing CRM leads. */
interface CheckItem {
  id: string;
  company: string;
  email?: string;
}

/**
 * Shared Zoho CRM state: which records already exist in CRM, and the push /
 * re-check actions. `links` is seeded from localStorage for an instant render,
 * then reconciled against CRM itself via `check`, so a record created in an
 * earlier session still shows as "In CRM" in a browser that has never seen it.
 */
export function useCrm() {
  const [links, setLinks] = useState<CrmLinks>({});
  const [status, setStatus] = useState<ZohoStatus | null>(null);
  /** Local ids with a push or check in flight. */
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const linksRef = useRef<CrmLinks>({});
  const setAndSave = useCallback((next: CrmLinks) => {
    linksRef.current = next;
    setLinks(next);
    saveCrmLinks(next);
  }, []);

  useEffect(() => {
    const stored = loadCrmLinks();
    linksRef.current = stored;
    // localStorage is unreadable during SSR, so this has to happen after mount
    // or the server and client markup disagree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLinks(stored);

    let active = true;
    fetch("/api/zoho/status")
      .then((r) => r.json())
      .then((data: ZohoStatus) => {
        if (active) setStatus(data);
      })
      .catch(() => {
        if (active) setStatus({ configured: false, leadSource: "", crmBaseUrl: "" });
      });
    return () => {
      active = false;
    };
  }, []);

  const markPending = useCallback((ids: string[], on: boolean) => {
    setPending((prev) =>
      on ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.includes(id)),
    );
  }, []);

  /**
   * Ask Zoho which of these already exist and fold the answer into `links`.
   * Safe to call on load — it only reads.
   */
  const check = useCallback(
    async (items: CheckItem[]) => {
      if (items.length === 0) return;
      try {
        const res = await fetch("/api/zoho/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "CRM check failed");
        if (data.existing) {
          setAndSave(applyExisting(linksRef.current, data.existing));
        }
      } catch (err) {
        // A failed check is not fatal: the push path re-checks server-side.
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setAndSave],
  );

  /**
   * Create Zoho CRM leads for the given catalog records and/or discovered
   * leads. Records already in CRM come back as duplicates and are remembered
   * rather than inserted again.
   */
  const push = useCallback(
    async ({
      records = [],
      leads = [],
    }: {
      records?: DirectoryRecord[];
      leads?: Lead[];
    }): Promise<ZohoPushResult[]> => {
      const ids = [...records.map((r) => r.id), ...leads.map((l) => l.id)];
      if (ids.length === 0) return [];

      markPending(ids, true);
      setError(null);
      try {
        const res = await fetch("/api/zoho/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records, leads }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Push to Zoho CRM failed");

        const results: ZohoPushResult[] = data.results ?? [];
        setAndSave(applyPushResults(linksRef.current, results));

        const failed = results.filter((r) => r.status === "error");
        if (failed.length) {
          setError(
            `${failed.length} of ${results.length} could not be created: ${failed[0].message}`,
          );
        }
        return results;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      } finally {
        markPending(ids, false);
      }
    },
    [markPending, setAndSave],
  );

  return {
    links,
    status,
    pending,
    error,
    clearError: useCallback(() => setError(null), []),
    push,
    check,
  };
}
