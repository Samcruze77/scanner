// PostgREST returns at most its configured max rows per request (1000 by
// default) regardless of `.limit()`, so any query that needs the whole set
// must page. Keyset paging on the primary key (never OFFSET) stays correct
// and fast while rows are being inserted.

export const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

export async function fetchAllByKeyset<T extends { id: number }>(
  fetchPage: (afterId: number, pageSize: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  let afterId = 0;
  for (;;) {
    const { data, error } = await fetchPage(afterId, pageSize);
    if (error) return { rows, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
    afterId = page[page.length - 1].id;
  }
}

// Splits ids into chunks small enough for a PostgREST/RPC request body.
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
