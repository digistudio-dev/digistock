# DigiStock — documentation développeur

## Architecture

```
src/                         Frontend React + TypeScript (Vite, Tailwind)
  app/                       Démarrage, routeur (hash), shell (sidebar, barre, palette Ctrl+K, notifications)
  components/ui/             Primitives (boutons, champs, dialogues, menus) basées sur Radix
  components/common/         Composants métier réutilisables (DataTable, sélecteurs, codes-barres, graphiques…)
  features/<module>/         Pages et logique d'interface par domaine (sales, products, purchases…)
  hooks/                     Scanner global, raccourcis, actions avec toasts, tables paginées
  lib/                       Calculs (miroir du backend), formatage fr-MA, CSV, PDF, impression, IPC
  stores/                    Zustand : session/paramètres, préférences UI, pile de gestionnaires de scan
  i18n/                      Dictionnaire typé (fr-MA par défaut, prêt pour ar / en)

src-tauri/                   Backend Rust (Tauri 2)
  migrations/                Migrations SQL embarquées (jamais modifiées une fois publiées)
  src/db.rs                  Connexion SQLite (WAL, clés étrangères), migrations, numérotation, garde lecture seule
  src/domain/                Règles métier et transactions : stock, ventes, achats, crédit, produits, auth, CRUD contrôlé
  src/commands.rs            Commandes Tauri : session + permission → domaine
  src/premium.rs             Activation hors ligne (SHA-256 + état signé HMAC lié à la machine)
  src/backup.rs              VACUUM INTO, restauration sécurisée, sauvegardes automatiques
  src/whatsapp.rs            Gestion du service WhatsApp (processus enfant, stdin/stdout)
  src/seed.rs                Données de démonstration (compilé uniquement en debug)

sidecar/whatsapp/            Service Node.js whatsapp-web.js (regroupé par esbuild)
scripts/                     build-sidecar.mjs, premium-hash.mjs
```

### Principes

- **Les écritures passent par Rust.** Le frontend lit via `db_select` (requêtes vérifiées en lecture seule par SQLite — `stmt.readonly()` — et interdiction des colonnes sensibles) et écrit uniquement via des commandes métier (`sale_create`, `stock_adjust`, …) ou le CRUD contrôlé `entity_save` (tables et colonnes en liste blanche).
- **Transactions atomiques.** Vente, annulation, achat, réception, transfert, inventaire, paiements : `BEGIN … COMMIT`, rollback automatique en cas d'erreur (testé : `failed_sale_rolls_back_everything`).
- **Le stock n'est jamais modifié directement.** `domain::stock::apply_movement` est l'unique point d'entrée : il enregistre `quantity_before` / `quantity_after`, met à jour `warehouse_stock` puis `products.quantity`, consomme les lots en FEFO et déclenche les alertes.
- **Bénéfice historique exact.** Le coût d'achat est figé dans `sale_items.unit_cost` au moment de la vente.
- **Aucune suppression des données comptables.** Ventes et achats sont annulés (avec motif), les référentiels sont archivés.
- **Permissions vérifiées côté Rust** (`AppState::require`), l'interface ne fait que masquer.

## Base de données

SQLite dans `%APPDATA%\dev.digistudio.digistock\digistock.db`. Tables principales : `companies, settings, users, roles, permissions, role_permissions, user_roles, categories, products, suppliers, customers, warehouses, warehouse_stock, product_batches, stock_movements, sales, sale_items, sale_payments, customer_credit_transactions, purchases, purchase_items, supplier_payments, stock_transfers, stock_transfer_items, inventory_sessions, inventory_items, whatsapp_messages, notifications, audit_logs, premium_activation, backups, document_sequences, schema_migrations` et, pour la fabrication future, `bill_of_materials, bom_items, production_orders`.

### Ajouter une migration

1. Créer `src-tauri/migrations/0002_description.sql`.
2. L'ajouter à `MIGRATIONS` dans `src-tauri/src/db.rs`.
3. Ne jamais modifier une migration déjà livrée. Les bases existantes sont migrées automatiquement au démarrage et après une restauration ; une sauvegarde issue d'une version plus récente est refusée.

### Numérotation

`document_sequences(prefix, year, value)` incrémenté dans la transaction du document : `V-2026-000001`, `ACH-…`, `PAY-…`, `REG-…`, `INV-…`, `TRF-…`. La facture A4 reprend le numéro de vente (`FAC-2026-000001`). Une transaction annulée ne consomme pas de numéro.

## Calculs

- Prix de vente TTC par défaut (`sales.prices_include_tax`). TVA extraite par ligne : `TVA = total × taux / (100 + taux)`.
- La remise globale est répartie au prorata des lignes, la dernière ligne absorbe l'arrondi.
- `src/lib/calc.ts` est le miroir exact de `domain/sales.rs::compute_totals` (testés tous les deux) : l'interface affiche instantanément, le backend recalcule toujours.
- Réapprovisionnement (`src/lib/reorder.ts`) : `ventes/jour × délai fournisseur + stock de sécurité − stock actuel`, stock de sécurité = max(stock minimum, ventes/jour × jours de sécurité). Sans historique : double du stock minimum.

## Codes-barres

Les douchettes USB émulent un clavier. `useBarcodeScanner` détecte une rafale de frappes (< 50 ms) terminée par Entrée lorsque le focus n'est pas dans un champ. Les pages (caisse, inventaire, achats, étiquettes, transferts) interceptent le scan via `useScanHandler` ; sinon le shell ouvre la fiche produit ou propose « Créer ce produit ». La recherche de la caisse reçoit aussi directement les scans (Entrée = ajout immédiat, scan répété = quantité +1).

## Sécurité

- Mots de passe : Argon2id (crate `argon2`), jamais stockés ni journalisés en clair. Délai progressif après échecs de connexion.
- Premium : `sha256("digistock:v1:" + code normalisé)` comparé en temps constant aux 5 empreintes compilées dans le binaire Rust. L'état d'activation est signé (HMAC-SHA256) et lié à l'identifiant machine.
- Tauri : CSP stricte, capacités minimales (aucun accès fichier depuis le JS). Les boîtes « Enregistrer sous / Ouvrir » sont ouvertes par Rust ; le protocole `asset:` est limité au dossier `images`.
- Les journaux (`%LOCALAPPDATA%\dev.digistudio.digistock\logs`) ne contiennent ni mot de passe ni code. Export depuis Paramètres › À propos.

## WhatsApp (Premium)

- `sidecar/whatsapp/src/index.js` utilise `whatsapp-web.js` avec `LocalAuth` (session persistante dans `%APPDATA%\…\whatsapp-session`).
- Pas de Chromium embarqué : le service utilise **Microsoft Edge** (présent sur Windows 10/11) ou Google Chrome.
- Communication **exclusivement via stdin/stdout** (JSON par ligne) : aucun port réseau n'est ouvert.
- `npm run sidecar:build` regroupe le service (esbuild) dans `src-tauri/resources/whatsapp/index.cjs` et copie `node.exe` comme binaire externe Tauri (`src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`).
- Aucun message n'est envoyé sans clic explicite sur « Envoyer » ; l'historique est conservé dans `whatsapp_messages`.

## Impression et PDF

- Impression : HTML dans un iframe isolé → boîte de dialogue Windows (choix de l'imprimante, aperçu, copies). Formats 58 mm, 80 mm, A4, étiquettes.
- PDF : jsPDF + jspdf-autotable (ticket thermique, facture A4, bon de commande/réception, reçu de paiement, relevé client, rapports).

## Sauvegardes

`VACUUM INTO` produit une copie cohérente même en cours d'utilisation. La restauration valide le fichier (`quick_check`, tables attendues, version de schéma), crée une copie « avant restauration », remplace la base, applique les migrations puis déconnecte l'utilisateur. Les sauvegardes automatiques (Premium) sont vérifiées toutes les 15 minutes par un thread Rust.

## Mises à jour automatiques (architecture)

Le projet est prêt pour `tauri-plugin-updater` :
1. `cargo add tauri-plugin-updater` dans `src-tauri`, `npm i @tauri-apps/plugin-updater`.
2. Générer une paire de clés : `npx tauri signer generate`, renseigner `plugins.updater.pubkey` et `endpoints` dans `tauri.conf.json`, activer `bundle.createUpdaterArtifacts`.
3. Ajouter la permission `updater:default` à `capabilities/default.json` et un bouton « Rechercher une mise à jour » dans Paramètres › À propos.
Les migrations embarquées garantissent la mise à niveau des bases existantes.

## Fabrication (évolution prévue)

Les tables `bill_of_materials`, `bom_items`, `production_orders`, le type de mouvement `PRODUCTION` et les types de produit `raw_material` / `finished_good` sont en place. Un ordre de production consommera les composants (`PRODUCTION` négatif) et ajoutera le produit fini (`PRODUCTION` positif) via `apply_movement` dans une transaction.

## Comptes de test (développement uniquement)

| Identifiant | Mot de passe | Origine |
|---|---|---|
| `admin` | `admin123` | Bouton « Données de démo » de l'assistant (build debug uniquement) |
