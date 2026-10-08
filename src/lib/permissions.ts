export const PERMISSIONS = [
  "view_dashboard",
  "manage_products",
  "view_purchase_price",
  "manage_stock",
  "create_sales",
  "cancel_sales",
  "manage_purchases",
  "manage_suppliers",
  "manage_customers",
  "view_reports",
  "view_profit",
  "manage_users",
  "manage_settings",
  "manage_backups",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_dashboard: "Voir le tableau de bord",
  manage_products: "Gérer les produits",
  view_purchase_price: "Voir les prix d'achat",
  manage_stock: "Gérer le stock",
  create_sales: "Créer des ventes",
  cancel_sales: "Annuler des ventes",
  manage_purchases: "Gérer les achats",
  manage_suppliers: "Gérer les fournisseurs",
  manage_customers: "Gérer les clients",
  view_reports: "Voir les rapports",
  view_profit: "Voir les bénéfices",
  manage_users: "Gérer les utilisateurs",
  manage_settings: "Gérer les paramètres",
  manage_backups: "Gérer les sauvegardes",
};

/** Vrai si l'utilisateur possède au moins une des permissions demandées. */
export function hasPermission(perms: readonly string[] | undefined, p: Permission | Permission[] | undefined) {
  if (!p) return true;
  if (!perms) return false;
  const list = Array.isArray(p) ? p : [p];
  return list.some((x) => perms.includes(x));
}
