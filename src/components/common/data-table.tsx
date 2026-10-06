import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/menu";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";

export type { ColumnDef, SortingState };

export interface ColumnMeta {
  align?: "left" | "right" | "center";
  className?: string;
  /** Libellé utilisé dans le menu de visibilité des colonnes. */
  label?: string;
}

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  data: T[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  sorting?: SortingState;
  onSortingChange?: (s: SortingState) => void;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  contextMenu?: (row: T) => ReactNode;
  selectable?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  empty?: ReactNode;
  visibilityKey?: string;
  toolbar?: ReactNode;
  toolbarRight?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  dense?: boolean;
  footer?: ReactNode;
}

function loadVisibility(key?: string): VisibilityState {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(`digistock.cols.${key}`) ?? "{}");
  } catch {
    return {};
  }
}

export function DataTable<T>({
  columns,
  data,
  loading,
  total,
  page = 0,
  pageSize = 25,
  onPageChange,
  onPageSizeChange,
  sorting,
  onSortingChange,
  getRowId,
  onRowClick,
  contextMenu,
  selectable,
  onSelectionChange,
  empty,
  visibilityKey,
  toolbar,
  toolbarRight,
  rowClassName,
  className,
  dense,
  footer,
}: DataTableProps<T>) {
  const [visibility, setVisibility] = useState<VisibilityState>(() => loadVisibility(visibilityKey));
  const [selection, setSelection] = useState<RowSelectionState>({});

  useEffect(() => {
    if (!visibilityKey) return;
    try {
      localStorage.setItem(`digistock.cols.${visibilityKey}`, JSON.stringify(visibility));
    } catch {
      /* ignore */
    }
  }, [visibility, visibilityKey]);

  const cols = useMemo<ColumnDef<T, any>[]>(() => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!selectable) return columns;
    return [
      {
        id: "__select",
        enableSorting: false,
        enableHiding: false,
        size: 36,
        header: ({ table }) => (
          <Checkbox
            aria-label="Tout sélectionner"
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllRowsSelected(v)}
          />
        ),
        cell: ({ row }) => <Checkbox aria-label="Sélectionner" checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(v)} />,
      },
      ...columns,
    ];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: !!selectable,
    getRowId: getRowId ? (r) => getRowId(r) : undefined,
    state: { sorting: sorting ?? [], columnVisibility: visibility, rowSelection: selection },
    onSortingChange: (u) => {
      if (!onSortingChange) return;
      onSortingChange(typeof u === "function" ? u(sorting ?? []) : u);
    },
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setSelection,
    enableSortingRemoval: false,
  });

  useEffect(() => {
    onSelectionChange?.(table.getSelectedRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => setSelection({}), [page, data]);

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== "__select" && (c.columnDef.meta as ColumnMeta | undefined)?.label);
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const showPager = total !== undefined && onPageChange;
  const rowH = dense ? "h-9" : "h-[var(--row-h)]";

  return (
    <div className={cn("card flex min-w-0 flex-col overflow-hidden", className)}>
      {(toolbar || toolbarRight || hideable.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          <div className="flex items-center gap-2">
            {toolbarRight}
            {hideable.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    <Columns3 /> Colonnes
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
                  {hideable.map((c) => (
                    <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(v)}>
                      {(c.columnDef.meta as ColumnMeta).label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
          <thead className="sticky top-0 z-[1]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as ColumnMeta | undefined;
                  const canSort = h.column.getCanSort() && !!onSortingChange;
                  const sorted = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.column.columnDef.size !== 150 ? h.column.columnDef.size : undefined }}
                      className={cn(
                        "h-9 whitespace-nowrap border-b bg-subtle px-3 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground first:pl-4 last:pr-4",
                        meta?.align === "right" && "text-right",
                        meta?.align === "center" && "text-center",
                      )}
                    >
                      {h.isPlaceholder ? null : canSort ? (
                        <button
                          className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", sorted && "text-foreground", meta?.align === "right" && "flex-row-reverse")}
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && data.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {table.getVisibleLeafColumns().map((c) => (
                      <td key={c.id} className={cn(rowH, "border-b px-3 first:pl-4 last:pr-4")}>
                        <Skeleton className="h-3.5 w-[70%]" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => {
                  const tr = (
                    <tr
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      className={cn(
                        "group transition-colors",
                        onRowClick && "cursor-pointer",
                        row.getIsSelected() ? "bg-primary-soft/70" : "hover:bg-accent/60",
                        rowClassName?.(row.original),
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              rowH,
                              "border-b px-3 align-middle first:pl-4 last:pr-4",
                              meta?.align === "right" && "num text-right",
                              meta?.align === "center" && "text-center",
                              meta?.className,
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                  if (!contextMenu) return tr;
                  return (
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger asChild>{tr}</ContextMenuTrigger>
                      <ContextMenuContent>{contextMenu(row.original)}</ContextMenuContent>
                    </ContextMenu>
                  );
                })}
          </tbody>
        </table>
        {!loading && data.length === 0 && <div className="border-t-0">{empty}</div>}
      </div>
      {footer}
      {showPager && (total ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-[0.8125rem] text-muted-foreground">
          <span className="num">
            {int(page * pageSize + 1)}–{int(Math.min((page + 1) * pageSize, total ?? 0))} sur {int(total)}
          </span>
          <div className="flex items-center gap-2">
            {onPageSizeChange && (
              <Select inputSize="sm" className="w-[108px]" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </Select>
            )}
            <span className="num px-1">
              Page {page + 1} / {pages}
            </span>
            <Button variant="secondary" size="icon-sm" disabled={page === 0} onClick={() => onPageChange!(page - 1)} aria-label="Page précédente">
              <ChevronLeft />
            </Button>
            <Button variant="secondary" size="icon-sm" disabled={page >= pages - 1} onClick={() => onPageChange!(page + 1)} aria-label="Page suivante">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
