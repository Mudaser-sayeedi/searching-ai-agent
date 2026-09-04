"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageNumbers } from "@/lib/paginate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** 1-based range currently shown, for the "Showing x–y of n" label. */
  from: number;
  to: number;
  total: number;
  /** What the items are called in the label, e.g. "profiles". */
  noun?: string;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Page navigation for a list: a range label plus first/last-aware page buttons. */
export function Pagination({
  page,
  pageCount,
  from,
  to,
  total,
  noun = "items",
  onPageChange,
  className,
}: PaginationProps) {
  if (total === 0) return null;

  const go = (next: number) => onPageChange(Math.min(Math.max(1, next), pageCount));

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "mt-4 flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">
        Showing {from}–{to} of {total} {noun}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3 w-3" /> Prev
          </Button>

          {pageNumbers(page, pageCount).map((n, i) =>
            n === null ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-xs text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={n}
                variant={n === page ? "default" : "outline"}
                size="xs"
                onClick={() => go(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className="min-w-7 px-2"
              >
                {n}
              </Button>
            ),
          )}

          <Button
            variant="outline"
            size="xs"
            onClick={() => go(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            Next <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </nav>
  );
}
