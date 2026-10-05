-- DigiStock — schéma initial (v1)
-- Conventions:
--   * Dates stockées en heure locale 'YYYY-MM-DD HH:MM:SS'.
--   * Montants en DH (REAL arrondi à 2 décimales côté application).
--   * Aucune suppression physique des données comptables ou de stock : archivage / annulation.

CREATE TABLE companies (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  name             TEXT NOT NULL,
  phone            TEXT,
  whatsapp         TEXT,
  email            TEXT,
  address          TEXT,
  city             TEXT,
  ice              TEXT,
  if_number        TEXT,
  rc               TEXT,
  logo             TEXT,
  currency         TEXT NOT NULL DEFAULT 'MAD',
  business_type    TEXT NOT NULL DEFAULT 'commerce',
  default_tax_rate REAL NOT NULL DEFAULT 20,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------------------------------------------------------------- Utilisateurs
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email         TEXT,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE roles (
  id         INTEGER PRIMARY KEY,
  code       TEXT UNIQUE,
  name       TEXT NOT NULL UNIQUE,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE permissions (
  code  TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------- Référentiels
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  color       TEXT,
  icon        TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX ux_categories_name ON categories(name) WHERE archived = 0;

CREATE TABLE suppliers (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  company_name   TEXT,
  phone          TEXT,
  whatsapp       TEXT,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  ice            TEXT,
  payment_terms  TEXT,
  lead_time_days INTEGER NOT NULL DEFAULT 3 CHECK (lead_time_days >= 0),
  notes          TEXT,
  balance        REAL NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_suppliers_name ON suppliers(name);

CREATE TABLE customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  whatsapp     TEXT,
  email        TEXT,
  address      TEXT,
  city         TEXT,
  ice          TEXT,
  notes        TEXT,
  credit_limit REAL NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  balance      REAL NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_customers_name ON customers(name);
CREATE INDEX ix_customers_phone ON customers(phone);

CREATE TABLE warehouses (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  manager    TEXT,
  notes      TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------------------------------------------------------------- Produits & stock
CREATE TABLE products (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  sku             TEXT,
  barcode         TEXT,
  description     TEXT,
  category_id     INTEGER REFERENCES categories(id),
  brand           TEXT,
  image           TEXT,
  purchase_price  REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price   REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  tax_rate        REAL NOT NULL DEFAULT 20 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  quantity        REAL NOT NULL DEFAULT 0,
  minimum_stock   REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  maximum_stock   REAL CHECK (maximum_stock IS NULL OR maximum_stock >= 0),
  unit            TEXT NOT NULL DEFAULT 'piece',
  supplier_id     INTEGER REFERENCES suppliers(id),
  warehouse_id    INTEGER REFERENCES warehouses(id),
  location        TEXT,
  batch_number    TEXT,
  expiration_date TEXT,
  track_batches   INTEGER NOT NULL DEFAULT 0,
  product_type    TEXT NOT NULL DEFAULT 'standard'
                  CHECK (product_type IN ('standard','raw_material','finished_good','service')),
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX ux_products_barcode ON products(barcode)
  WHERE barcode IS NOT NULL AND barcode <> '' AND archived = 0;
CREATE UNIQUE INDEX ux_products_sku ON products(sku)
  WHERE sku IS NOT NULL AND sku <> '' AND archived = 0;
CREATE INDEX ix_products_name ON products(name COLLATE NOCASE);
CREATE INDEX ix_products_category ON products(category_id);
CREATE INDEX ix_products_supplier ON products(supplier_id);
CREATE INDEX ix_products_archived ON products(archived);
CREATE INDEX ix_products_expiration ON products(expiration_date) WHERE expiration_date IS NOT NULL;

CREATE TABLE warehouse_stock (
  product_id   INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  quantity     REAL NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE INDEX ix_warehouse_stock_wh ON warehouse_stock(warehouse_id);

CREATE TABLE product_batches (
  id               INTEGER PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id),
  batch_number     TEXT,
  purchase_date    TEXT,
  expiration_date  TEXT,
  initial_quantity REAL NOT NULL DEFAULT 0,
  quantity         REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  purchase_id      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_batches_product ON product_batches(product_id, warehouse_id);
CREATE INDEX ix_batches_expiration ON product_batches(expiration_date) WHERE quantity > 0;

CREATE TABLE stock_movements (
  id              INTEGER PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  type            TEXT NOT NULL CHECK (type IN ('PURCHASE','SALE','RETURN','ADJUSTMENT','DAMAGED',
                                                'TRANSFER','PRODUCTION','INITIAL','CANCELLED_SALE')),
  quantity        REAL NOT NULL,
  quantity_before REAL NOT NULL,
  quantity_after  REAL NOT NULL,
  unit_cost       REAL,
  reference       TEXT,
  reference_type  TEXT,
  reference_id    INTEGER,
  reason          TEXT,
  user_id         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX ix_movements_created ON stock_movements(created_at);
CREATE INDEX ix_movements_type ON stock_movements(type);

CREATE TABLE document_sequences (
  prefix TEXT NOT NULL,
  year   INTEGER NOT NULL,
  value  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

-- ---------------------------------------------------------------- Ventes
CREATE TABLE sales (
  id             INTEGER PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  customer_id    INTEGER REFERENCES customers(id),
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  user_id        INTEGER REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  subtotal       REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total      REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  cost_total     REAL NOT NULL DEFAULT 0,
  profit         REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  received_amount REAL NOT NULL DEFAULT 0,
  change_amount  REAL NOT NULL DEFAULT 0,
  credit_amount  REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','transfer','credit','other')),
  note           TEXT,
  cancelled_at   TEXT,
  cancelled_by   INTEGER REFERENCES users(id),
  cancel_reason  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_sales_created ON sales(created_at);
CREATE INDEX ix_sales_customer ON sales(customer_id);
CREATE INDEX ix_sales_status ON sales(status, created_at);

CREATE TABLE sale_items (
  id           INTEGER PRIMARY KEY,
  sale_id      INTEGER NOT NULL REFERENCES sales(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  barcode      TEXT,
  unit         TEXT,
  quantity     REAL NOT NULL CHECK (quantity > 0),
  unit_price   REAL NOT NULL CHECK (unit_price >= 0),
  unit_cost    REAL NOT NULL DEFAULT 0,
  discount     REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate     REAL NOT NULL DEFAULT 0,
  tax_amount   REAL NOT NULL DEFAULT 0,
  total        REAL NOT NULL,
  profit       REAL NOT NULL DEFAULT 0
);
CREATE INDEX ix_sale_items_sale ON sale_items(sale_id);
CREATE INDEX ix_sale_items_product ON sale_items(product_id);

CREATE TABLE sale_payments (
  id         INTEGER PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  method     TEXT NOT NULL CHECK (method IN ('cash','card','transfer','credit','other')),
  amount     REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE customer_credit_transactions (
  id            INTEGER PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  type          TEXT NOT NULL CHECK (type IN ('SALE','PAYMENT','SALE_CANCELLED','ADJUSTMENT')),
  amount        REAL NOT NULL,
  balance_after REAL NOT NULL,
  sale_id       INTEGER REFERENCES sales(id),
  number        TEXT,
  method        TEXT,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_credit_customer ON customer_credit_transactions(customer_id, created_at);

-- ---------------------------------------------------------------- Achats
CREATE TABLE purchases (
  id            INTEGER PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  reference     TEXT,
  purchase_date TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ordered','received','cancelled')),
  subtotal      REAL NOT NULL DEFAULT 0,
  tax_total     REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  paid_amount   REAL NOT NULL DEFAULT 0,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id),
  received_at   TEXT,
  cancelled_at  TEXT,
  cancel_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_purchases_supplier ON purchases(supplier_id);
CREATE INDEX ix_purchases_date ON purchases(purchase_date);
CREATE INDEX ix_purchases_status ON purchases(status);

CREATE TABLE purchase_items (
  id              INTEGER PRIMARY KEY,
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  product_name    TEXT NOT NULL,
  quantity        REAL NOT NULL CHECK (quantity > 0),
  unit_cost       REAL NOT NULL CHECK (unit_cost >= 0),
  tax_rate        REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL,
  batch_number    TEXT,
  expiration_date TEXT
);
CREATE INDEX ix_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX ix_purchase_items_product ON purchase_items(product_id);

CREATE TABLE supplier_payments (
  id          INTEGER PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  purchase_id INTEGER REFERENCES purchases(id),
  amount      REAL NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL,
  reference   TEXT,
  note        TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_supplier_payments_supplier ON supplier_payments(supplier_id);

-- ---------------------------------------------------------------- Transferts & inventaires
CREATE TABLE stock_transfers (
  id                       INTEGER PRIMARY KEY,
  number                   TEXT NOT NULL UNIQUE,
  source_warehouse_id      INTEGER NOT NULL REFERENCES warehouses(id),
  destination_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  reference                TEXT,
  notes                    TEXT,
  user_id                  INTEGER REFERENCES users(id),
  created_at               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (source_warehouse_id <> destination_warehouse_id)
);

CREATE TABLE stock_transfer_items (
  id          INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    REAL NOT NULL CHECK (quantity > 0)
);
CREATE INDEX ix_transfer_items_transfer ON stock_transfer_items(transfer_id);

CREATE TABLE inventory_sessions (
  id           INTEGER PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','validated','cancelled')),
  notes        TEXT,
  user_id      INTEGER REFERENCES users(id),
  validated_at TEXT,
  validated_by INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE inventory_items (
  id                INTEGER PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES inventory_sessions(id),
  product_id        INTEGER NOT NULL REFERENCES products(id),
  expected_quantity REAL NOT NULL,
  counted_quantity  REAL NOT NULL CHECK (counted_quantity >= 0),
  difference        REAL NOT NULL,
  counted_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (session_id, product_id)
);

-- ---------------------------------------------------------------- Communication, notifications, audit
CREATE TABLE whatsapp_messages (
  id             INTEGER PRIMARY KEY,
  recipient_name TEXT,
  phone          TEXT NOT NULL,
  message        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  entity         TEXT,
  entity_id      INTEGER,
  attachment     TEXT,
  status         TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error          TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_whatsapp_created ON whatsapp_messages(created_at);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','danger')),
  title      TEXT NOT NULL,
  body       TEXT,
  entity     TEXT,
  entity_id  INTEGER,
  dedupe_key TEXT UNIQUE,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_notifications_created ON notifications(created_at);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  user_name   TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   INTEGER,
  description TEXT NOT NULL,
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_audit_created ON audit_logs(created_at);
CREATE INDEX ix_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE premium_activation (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  slot         INTEGER NOT NULL,
  activated_at TEXT NOT NULL,
  machine_hash TEXT NOT NULL,
  signature    TEXT NOT NULL
);

CREATE TABLE backups (
  id         INTEGER PRIMARY KEY,
  file_name  TEXT NOT NULL,
  path       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL CHECK (kind IN ('manual','automatic','pre_restore')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------------------------------------------------------------- Fabrication (architecture future)
CREATE TABLE bill_of_materials (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  notes      TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE bom_items (
  id                   INTEGER PRIMARY KEY,
  bom_id               INTEGER NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
  component_product_id INTEGER NOT NULL REFERENCES products(id),
  quantity             REAL NOT NULL CHECK (quantity > 0)
);

CREATE TABLE production_orders (
  id           INTEGER PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  bom_id       INTEGER NOT NULL REFERENCES bill_of_materials(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  quantity     REAL NOT NULL CHECK (quantity > 0),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','cancelled')),
  user_id      INTEGER REFERENCES users(id),
  completed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------------------------------------------------------------- Données de référence
INSERT INTO permissions (code, label) VALUES
  ('view_dashboard',      'Voir le tableau de bord'),
  ('manage_products',     'Gérer les produits'),
  ('view_purchase_price', 'Voir les prix d''achat'),
  ('manage_stock',        'Gérer le stock'),
  ('create_sales',        'Créer des ventes'),
  ('cancel_sales',        'Annuler des ventes'),
  ('manage_purchases',    'Gérer les achats'),
  ('manage_suppliers',    'Gérer les fournisseurs'),
  ('manage_customers',    'Gérer les clients'),
  ('view_reports',        'Voir les rapports'),
  ('view_profit',         'Voir les bénéfices'),
  ('manage_users',        'Gérer les utilisateurs'),
  ('manage_settings',     'Gérer les paramètres'),
  ('manage_backups',      'Gérer les sauvegardes');

INSERT INTO roles (id, code, name, is_system) VALUES
  (1, 'admin',      'Administrateur', 1),
  (2, 'manager',    'Gérant',         1),
  (3, 'cashier',    'Caissier',       1),
  (4, 'storekeeper','Magasinier',     1);

INSERT INTO role_permissions (role_id, permission_code) SELECT 1, code FROM permissions;
INSERT INTO role_permissions (role_id, permission_code) SELECT 2, code FROM permissions
  WHERE code NOT IN ('manage_users','manage_settings');
INSERT INTO role_permissions (role_id, permission_code) VALUES
  (3, 'create_sales'), (3, 'manage_customers');
INSERT INTO role_permissions (role_id, permission_code) VALUES
  (4, 'manage_products'), (4, 'manage_stock'), (4, 'manage_purchases'),
  (4, 'manage_suppliers'), (4, 'view_purchase_price');

INSERT INTO warehouses (id, name, is_default) VALUES (1, 'Magasin principal', 1);
