import { useQuery } from "@tanstack/react-query";
import { BellRing, HandCoins, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Kpi } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { one, like, select } from "@/lib/db";
import { date, int, money, relative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { useCan } from "@/stores/app";
import { CustomerPaymentDialog } from "./payment-dialog";
import { usePaymentReminder } from "./reminder";

interface Row {
  id: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  balance: number;
  credit_limit: number;
  last_credit: string | null;
  last_payment: string | null;
}

export function CreditsPage() {
  const navigate = useNavigate();
  const can = useCan();
  const remind = usePaymentReminder();
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<Row | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["credits", search],
    queryFn: () =>
      select<Row>(
        `SELECT c.id, c.name, c.phone, c.whatsapp, c.balance, c.credit_limit,
           (SELECT MAX(created_at) FROM customer_credit_transactions WHERE customer_id = c.id AND type = 'SALE') AS last_credit,
           (SELECT MAX(created_at) FROM customer_credit_transactions WHERE customer_id = c.id AND type = 'PAYMENT') AS last_payment
         FROM customers c WHERE c.archived = 0 AND c.balance > 0 AND (?1 = '' OR c.name LIKE ?2 ESCAPE '\\' OR c.phone LIKE ?2 ESCAPE '\\')
         ORDER BY c.balance DESC`,
        [search.trim(), like(search)],
      ),
  });
  const { data: stats } = useQuery({
    queryKey: ["credits", "stats"],
    queryFn: () =>
      one<{ total: number; count: number; month_paid: number; month_credit: number }>(
        `SELECT COALESCE((SELECT SUM(balance) FROM customers WHERE archived = 0 AND balance > 0), 0) AS total,
           (SELECT COUNT(*) FROM customers WHERE archived = 0 AND balance > 0) AS count,
           COALESCE((SELECT -SUM(amount) FROM customer_credit_transactions WHERE type = 'PAYMENT' AND created_at >= date('now','localtime','start of month')), 0) AS month_paid,
           COALESCE((SELECT SUM(amount) FROM customer_credit_transactions WHERE type = 'SALE' AND created_at >= date('now','localtime','start of month')), 0) AS month_credit`,
      ),
  });

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Client", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { id: "phone", header: "Téléphone", cell: ({ row }) => <span className="num">{formatPhone(row.original.phone)}</span> },
      { id: "last_credit", header: "Dernière vente à crédit", cell: ({ row }) => <span className="text-muted-foreground">{date(row.original.last_credit)}</span> },
      { id: "last_payment", header: "Dernier paiement", cell: ({ row }) => <span className="text-muted-foreground">{row.original.last_payment ? relative(row.original.last_payment) : "Jamais"}</span> },
      {
        id: "limit",
        header: "Plafond",
        meta: { align: "right" },
        cell: ({ row: { original: r } }) =>
          r.credit_limit ? <span className={r.balance > r.credit_limit ? "font-semibold text-danger" : "text-muted-foreground"}>{money(r.credit_limit)}</span> : <span className="text-muted-foreground">—</span>,
      },
      { id: "balance", header: "Solde dû", meta: { align: "right" }, cell: ({ row }) => <span className="font-bold text-warning">{money(row.original.balance)}</span> },
      {
        id: "actions",
        header: "",
        cell: ({ row: { original: r } }) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => remind(r)}>
              <BellRing /> Relancer
            </Button>
            {can("manage_customers") && (
              <Button size="sm" variant="secondary" onClick={() => setPaying(r)}>
                <HandCoins /> Paiement
              </Button>
            )}
          </div>
        ),
      },
    ],
    [can, remind],
  );

  return (
    <Page>
      <PageHeader title="Crédits clients" description="Suivez ce que vos clients vous doivent et encaissez les règlements." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total des crédits" value={money(stats?.total)} tone={stats?.total ? "warning" : undefined} />
        <Kpi label="Clients concernés" value={int(stats?.count)} />
        <Kpi label="Crédits accordés ce mois" value={money(stats?.month_credit)} />
        <Kpi label="Encaissé ce mois" value={money(stats?.month_paid)} tone="success" />
      </div>
      <DataTable
        columns={columns}
        data={data}
        loading={isLoading}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Rechercher un client…" />}
        empty={<EmptyState icon={<Wallet />} title="Aucun crédit en cours" description="Les ventes à crédit apparaîtront ici avec le solde de chaque client." />}
      />
      {paying && <CustomerPaymentDialog open onOpenChange={(o) => !o && setPaying(null)} customerId={paying.id} customerName={paying.name} balance={paying.balance} />}
    </Page>
  );
}
