export interface Session {
  user_id: number;
  name: string;
  username: string;
  role_id: number | null;
  role_name: string | null;
  permissions: string[];
}

export interface PremiumStatus {
  active: boolean;
  activated_at: string | null;
}

export interface Company {
  id?: number;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  ice?: string | null;
  if_number?: string | null;
  rc?: string | null;
  logo?: string | null;
  currency?: string;
  business_type?: string;
  default_tax_rate?: number;
}

export interface Bootstrap {
  setup_done: boolean;
  premium: PremiumStatus;
  version: string;
  debug: boolean;
  company: Pick<Company, "name" | "logo" | "city"> | null;
  images_dir: string;
  backups_dir: string;
  session: Session | null;
}

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  category_id: number | null;
  category_name?: string | null;
  category_color?: string | null;
  brand: string | null;
  image: string | null;
  purchase_price: number;
  selling_price: number;
  tax_rate: number;
  quantity: number;
  minimum_stock: number;
  maximum_stock: number | null;
  unit: string;
  supplier_id: number | null;
  supplier_name?: string | null;
  warehouse_id: number | null;
  location: string | null;
  batch_number: string | null;
  expiration_date: string | null;
  track_batches: number;
  product_type: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  ice: string | null;
  notes: string | null;
  credit_limit: number;
  balance: number;
  archived: number;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  company_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  ice: string | null;
  payment_terms: string | null;
  lead_time_days: number;
  notes: string | null;
  balance: number;
  archived: number;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  archived: number;
}

export interface Warehouse {
  id: number;
  name: string;
  address: string | null;
  manager: string | null;
  notes: string | null;
  is_default: number;
  archived: number;
}

export interface Sale {
  id: number;
  number: string;
  customer_id: number | null;
  customer_name?: string | null;
  warehouse_id: number;
  user_id: number | null;
  user_name?: string | null;
  status: "completed" | "cancelled";
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  cost_total: number;
  profit: number;
  paid_amount: number;
  received_amount: number;
  change_amount: number;
  credit_amount: number;
  payment_method: string;
  note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  barcode: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  profit: number;
}

export interface Purchase {
  id: number;
  number: string;
  supplier_id: number;
  supplier_name?: string;
  warehouse_id: number;
  reference: string | null;
  purchase_date: string;
  status: "ordered" | "received" | "cancelled";
  subtotal: number;
  tax_total: number;
  total: number;
  paid_amount: number;
  note: string | null;
  received_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_cost: number;
  tax_rate: number;
  total: number;
  batch_number: string | null;
  expiration_date: string | null;
}

export interface Notification {
  id: number;
  type: string;
  level: "info" | "success" | "warning" | "danger";
  title: string;
  body: string | null;
  entity: string | null;
  entity_id: number | null;
  read_at: string | null;
  created_at: string;
}

export interface BackupInfo {
  file_name: string;
  path: string;
  size: number;
  created_at: string;
  kind: "manual" | "automatic" | "pre_restore";
}

export interface WaStatus {
  state: "disconnected" | "starting" | "qr" | "connecting" | "connected" | "error";
  qr: string | null;
  number: string | null;
  name: string | null;
  error: string | null;
}
