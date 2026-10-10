import { useQuery } from "@tanstack/react-query";
import { History, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { like, paged, select } from "@/lib/db";
import { date, time } from "@/lib/format";
import { usePremium } from "@/stores/app";

interface Row {
  id: number;
  user_name: string | null;
  action: string;
  entity: string | null;
  description: string;
  created_at: string;
}

const GROUPS: Record<string, string> = {
  "auth.": "Connexions",
  "sale.": "Ventes",
  "product": "Produits",
  "stock.": "Stock",
  "purchase.": "Achats",
  "customer": "Clients",
  "supplier": "Fournisseurs",
  "settings.": "Paramètres",
  "user.": "Utilisateurs",
  "backup.": "Sauvegardes",
};

export function ActivityPage() {
  const premium = usePremium();
  const gate = usePremiumGate();
  const t = useTableState([], { user: "", group: "", day: "" });
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (t.search) {
    where.push("description LIKE ? ESCAPE '\\'");
    params.push(like(t.search));
  }
  if (t.filters.user) {
    where.push("user_id = ?");
    params.push(Number(t.filters.user));
  }
  if (t.filters.group) {
    where.push("action LIKE ?");
    params.push(t.filters.group + "%");
  }
  if (t.filters.day) {
    where.push("date(created_at) = ?");
    params.push(t.filters.day);
  }
  const { data, isLoading } = usePagedQuery(["audit", t.search, t.filters, t.page, t.pageSize], () =>
    paged<Row>(`SELECT * FROM audit_logs WHERE ${where.join(" AND ")}`, params, { page: t.page, pageSize: t.pageSize, orderBy: "id DESC" }),
  );
  const { data: users = [] } = useQuery({ queryKey: ["users", "options"], queryFn: () => select<{ id: number; name: string }>("SELECT id, name FROM users ORDER BY name"), enabled: premium });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "time",
        header: "Heure",
        size: 130,
        cell: ({ row }) => (
          <span className="num text-muted-foreground">
            <span className="font-semibold text-foreground">{time(row.original.created_at)}</span> · {date(row.original.created_at)}
          </span>
        ),
      },
      { id: "description", header: "Action", cell: ({ row }) => row.original.description },
      { id: "user", header: "Utilisateur", cell: ({ row }) => <span className="text-muted-foreground">{row.original.user_name ?? "Système"}</span> },
    ],
    [],
  );

  if (!premium)
    return (
      <Page>
        <PageHeader title="Activités" />
        <Card>
          <EmptyState
            icon={<History />}
            title="Journal d'activité Premium"
            description="Sachez qui a vendu, annulé, modifié un prix ou ajusté le stock — avec l'heure exacte."
            actions={
              <Button onClick={() => gate.open("activity")}>
                <Sparkles /> Découvrir Premium
              </Button>
            }
          />
        </Card>
      </Page>
    );

  return (
    <Page>
      <PageHeader title="Activités" description="Journal horodaté des actions importantes de votre équipe." />
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        loading={isLoading}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        toolbar={
          <>
            <SearchInput value={t.search} onChange={t.setSearch} placeholder="Rechercher dans le journal…" />
            <Select inputSize="sm" className="w-44" value={t.filters.user} onChange={(e) => t.setFilter("user", e.target.value)}>
              <option value="">Tous les utilisateurs</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Select inputSize="sm" className="w-40" value={t.filters.group} onChange={(e) => t.setFilter("group", e.target.value)}>
              <option value="">Toutes les actions</option>
              {Object.entries(GROUPS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Input inputSize="sm" type="date" className="w-[150px]" value={t.filters.day} onChange={(e) => t.setFilter("day", e.target.value)} />
          </>
        }
        empty={<EmptyState compact icon={<History />} title="Aucune activité" />}
      />
    </Page>
  );
}
