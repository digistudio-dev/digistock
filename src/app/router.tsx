import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createHashRouter, Navigate, Outlet } from "react-router-dom";
import { LoadingRows } from "@/components/common/page";
import { AppShell } from "./shell/app-shell";
import { RequirePermission } from "./shell/guards";
import { RouteError } from "./shell/route-error";
import type { Permission } from "@/lib/permissions";

// Chargement différé des pages : démarrage rapide, code découpé par module.
function page<T>(loader: () => Promise<T>, name: keyof T) {
  const C = lazy(() => loader().then((m) => ({ default: m[name] as unknown as ComponentType })));
  return (perm?: Permission | Permission[]): ReactNode => {
    const el = (
      <Suspense fallback={<LoadingRows />}>
        <C />
      </Suspense>
    );
    return perm ? <RequirePermission perm={perm}>{el}</RequirePermission> : el;
  };
}

const Dashboard = page(() => import("@/features/dashboard/dashboard-page"), "DashboardPage");
const Pos = page(() => import("@/features/sales/pos-page"), "PosPage");
const Sales = page(() => import("@/features/sales/sales-page"), "SalesPage");
const SaleDetail = page(() => import("@/features/sales/sale-detail-page"), "SaleDetailPage");
const Products = page(() => import("@/features/products/products-page"), "ProductsPage");
const ProductForm = page(() => import("@/features/products/product-form-page"), "ProductFormPage");
const ProductDetail = page(() => import("@/features/products/product-detail-page"), "ProductDetailPage");
const Labels = page(() => import("@/features/products/labels-page"), "LabelsPage");
const ProductImport = page(() => import("@/features/products/import-page"), "ProductImportPage");
const Categories = page(() => import("@/features/categories/categories-page"), "CategoriesPage");
const Movements = page(() => import("@/features/stock/movements-page"), "MovementsPage");
const Inventory = page(() => import("@/features/inventory/inventory-page"), "InventoryPage");
const InventorySession = page(() => import("@/features/inventory/inventory-session-page"), "InventorySessionPage");
const PurchaseForm = page(() => import("@/features/purchases/purchase-form-page"), "PurchaseFormPage");
const Purchases = page(() => import("@/features/purchases/purchases-page"), "PurchasesPage");
const PurchaseDetail = page(() => import("@/features/purchases/purchase-detail-page"), "PurchaseDetailPage");
const Suppliers = page(() => import("@/features/suppliers/suppliers-page"), "SuppliersPage");
const SupplierDetail = page(() => import("@/features/suppliers/supplier-detail-page"), "SupplierDetailPage");
const Customers = page(() => import("@/features/customers/customers-page"), "CustomersPage");
const CustomerDetail = page(() => import("@/features/customers/customer-detail-page"), "CustomerDetailPage");
const Credits = page(() => import("@/features/customers/credits-page"), "CreditsPage");
const Warehouses = page(() => import("@/features/warehouses/warehouses-page"), "WarehousesPage");
const TransferForm = page(() => import("@/features/warehouses/transfer-form-page"), "TransferFormPage");
const Reports = page(() => import("@/features/reports/reports-page"), "ReportsPage");
const Actions = page(() => import("@/features/actions/action-center-page"), "ActionCenterPage");
const WhatsApp = page(() => import("@/features/whatsapp/whatsapp-page"), "WhatsAppPage");
const Users = page(() => import("@/features/users/users-page"), "UsersPage");
const Activity = page(() => import("@/features/activity/activity-page"), "ActivityPage");
const Backup = page(() => import("@/features/backup/backup-page"), "BackupPage");
const Settings = page(() => import("@/features/settings/settings-page"), "SettingsPage");

export const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        element: <Outlet />,
        errorElement: <RouteError />,
        children: [
      { index: true, element: Dashboard() },
      { path: "pos", element: Pos("create_sales") },
      { path: "sales", element: Sales() },
      { path: "sales/:id", element: SaleDetail() },
      { path: "products", element: Products() },
      { path: "products/new", element: ProductForm("manage_products") },
      { path: "products/import", element: ProductImport("manage_products") },
      { path: "products/labels", element: Labels() },
      { path: "products/:id", element: ProductDetail() },
      { path: "products/:id/edit", element: ProductForm("manage_products") },
      { path: "categories", element: Categories() },
      { path: "stock/movements", element: Movements() },
      { path: "inventory", element: Inventory("manage_stock") },
      { path: "inventory/:id", element: InventorySession("manage_stock") },
      { path: "purchases", element: Purchases("manage_purchases") },
      { path: "purchases/new", element: PurchaseForm("manage_purchases") },
      { path: "purchases/:id", element: PurchaseDetail("manage_purchases") },
      { path: "purchases/:id/edit", element: PurchaseForm("manage_purchases") },
      { path: "suppliers", element: Suppliers() },
      { path: "suppliers/:id", element: SupplierDetail() },
      { path: "customers", element: Customers() },
      { path: "customers/:id", element: CustomerDetail() },
      { path: "credits", element: Credits() },
      { path: "warehouses", element: Warehouses() },
      { path: "transfers/new", element: TransferForm("manage_stock") },
      { path: "reports", element: Reports("view_reports") },
      { path: "actions", element: Actions() },
      { path: "whatsapp", element: WhatsApp() },
      { path: "users", element: Users("manage_users") },
      { path: "activity", element: Activity("manage_users") },
      { path: "backup", element: Backup("manage_backups") },
      { path: "settings", element: <Navigate to="/settings/company" replace /> },
      { path: "settings/:section", element: Settings() },
      { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
], { future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true } });
