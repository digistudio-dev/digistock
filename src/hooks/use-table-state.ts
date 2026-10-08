import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import type { Page } from "@/lib/db";

/** État de liste paginée côté SQL (page, taille, tri, recherche, filtres). */
export function useTableState<F extends Record<string, unknown>>(initialSort: SortingState, initialFilters: F) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<F>(initialFilters);
  useEffect(() => setPage(0), [search, filters, pageSize, sorting]);
  return {
    page,
    setPage,
    pageSize,
    setPageSize,
    sorting,
    setSorting,
    search,
    setSearch,
    filters,
    setFilter: <K extends keyof F>(k: K, v: F[K]) => setFilters((f) => ({ ...f, [k]: v })),
    sort: sorting[0],
  };
}

export function usePagedQuery<T>(key: unknown[], fn: () => Promise<Page<T>>) {
  return useQuery({ queryKey: key, queryFn: fn, placeholderData: keepPreviousData });
}
