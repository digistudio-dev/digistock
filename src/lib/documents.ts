import { one, select } from "./db";
import { useApp } from "@/stores/app";
import type { Company, Customer, Sale, SaleItem } from "@/types";
import type { Settings } from "./settings";

export interface SaleDocument {
  sale: Sale & { user_name: string | null };
  items: SaleItem[];
  customer: Customer | null;
  company: Company;
  settings: Settings;
  payments: { method: string; amount: number }[];
}

export async function loadSaleDocument(saleId: number): Promise<SaleDocument> {
  const sale = await one<SaleDocument["sale"]>(
    "SELECT s.*, u.name AS user_name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    [saleId],
  );
  if (!sale) throw new Error("Vente introuvable.");
  const [items, customer, company, payments] = await Promise.all([
    select<SaleItem>("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", [saleId]),
    sale.customer_id ? one<Customer>("SELECT * FROM customers WHERE id = ?", [sale.customer_id]) : Promise.resolve(null),
    one<Company>("SELECT * FROM companies WHERE id = 1"),
    select<{ method: string; amount: number }>("SELECT method, amount FROM sale_payments WHERE sale_id = ?", [saleId]),
  ]);
  return { sale, items, customer, company: company ?? { name: "DigiStock" }, settings: useApp.getState().settings, payments };
}

export type ReceiptFormat = "ticket_58" | "ticket_80" | "a4";
