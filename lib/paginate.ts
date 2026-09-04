// Pure pagination maths, shared by the leads list and the catalog list.

export interface Page<T> {
  /** The items on the current page. */
  items: T[];
  /** Current page, clamped into range (1-based). */
  page: number;
  pageCount: number;
  /** 1-based index of the first item shown, or 0 when empty. */
  from: number;
  /** 1-based index of the last item shown, or 0 when empty. */
  to: number;
  total: number;
}

/**
 * Slice `items` into a page. `page` is clamped, so a filter that shrinks the
 * list below the current page still renders content instead of a blank list.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    total,
  };
}

/** Literal page numbers, with `null` marking a gap to render as an ellipsis. */
export function pageNumbers(
  page: number,
  pageCount: number,
  maxButtons = 7,
): (number | null)[] {
  if (pageCount <= maxButtons) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  // Always show first and last; slide a window around the current page.
  const side = Math.floor((maxButtons - 3) / 2);
  let start = Math.max(2, page - side);
  let end = Math.min(pageCount - 1, page + side);

  // Keep the button count stable when the window hits either end.
  const windowSize = maxButtons - 2;
  if (end - start + 1 < windowSize) {
    if (start === 2) end = Math.min(pageCount - 1, start + windowSize - 1);
    else start = Math.max(2, end - windowSize + 1);
  }

  const out: (number | null)[] = [1];
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}
