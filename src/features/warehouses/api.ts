import { useQuery } from "@tanstack/react-query";
import { select } from "@/lib/db";
import type { Warehouse } from "@/types";

export function useWarehouses(includeArchived = false) {
  return useQuery({
    queryKey: ["warehouses", includeArchived],
    queryFn: () => select<Warehouse>(`SELECT * FROM warehouses ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY is_default DESC, name`),
    staleTime: 60_000,
  });
}

export function useDefaultWarehouseId() {
  const { data } = useWarehouses();
  return data?.find((w) => w.is_default)?.id ?? data?.[0]?.id ?? 1;
}
