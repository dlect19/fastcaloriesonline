import { useEffect, useMemo, useState } from 'react';

export function usePagination<T>(items: T[], perPage: number = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));

  // Reset to page 1 when filtered list shrinks below current page
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const paged = useMemo(
    () => items.slice((page - 1) * perPage, page * perPage),
    [items, page, perPage]
  );

  return {
    page,
    setPage,
    totalPages,
    perPage,
    paged,
    totalItems: items.length,
  };
}
