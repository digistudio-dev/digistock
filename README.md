# DigiStock

**DigiStock par DigiStudio** — application de bureau Windows de gestion de stock, ventes, achats, fournisseurs, clients et crédits, conçue pour les commerces et PME marocains. 100 % hors ligne, interface en français (fr-MA), montants en DH.

## Fonctionnalités

| Module | FREE | PREMIUM |
|---|:-:|:-:|
| Caisse rapide (scan, clavier, espèces / carte / virement / crédit) | ✓ | ✓ |
| Tickets 58 / 80 mm, facture A4, PDF, impression | ✓ | ✓ |
| Produits, catégories, codes-barres EAN-13 / Code128, étiquettes | ✓ | ✓ |
| Mouvements de stock tracés, ajustements motivés, inventaires | ✓ | ✓ |
| Achats, commandes fournisseurs, réceptions, paiements | ✓ | ✓ |
| Clients, crédit client, paiements, relevés | ✓ | ✓ |
| Tableau de bord, rapports de base, alertes de stock, centre d'actions | ✓ | ✓ |
| Import / export CSV, sauvegarde et restauration manuelles | ✓ | ✓ |
| WhatsApp (reçus, factures, relances, commandes fournisseurs) | | ✓ |
| Utilisateurs multiples, rôles, permissions, journal d'activité | | ✓ |
| Entrepôts multiples, transferts de stock | | ✓ |
| Sauvegardes automatiques, rapports avancés, réapprovisionnement avancé | | ✓ |

Aucune limite de produits ni de ventes en version gratuite.

## Démarrage rapide

Prérequis : Windows 10/11, [Node.js 20+](https://nodejs.org), [Rust stable](https://rustup.rs), Visual Studio Build Tools (charge « Développement Desktop C++ »), WebView2 (inclus dans Windows 11).

```bash
npm install
```

```bash
npm run tauri dev
```

En mode développement, l'assistant de démarrage propose **« Données de démo »** (entreprise *Demo Store*, ~30 produits, clients, fournisseurs, 3 mois de ventes). Identifiants de test : `admin` / `admin123`. Ces données ne sont jamais créées dans une installation de production.

## Construire l'installateur Windows

```bash
npm run tauri build
```

L'installateur est généré dans `src-tauri/target/release/bundle/nsis/DigiStock_1.0.0_x64-setup.exe`. La commande prépare automatiquement le service WhatsApp (`npm run sidecar:build`) puis le frontend.

> Le dossier de compilation Rust occupe 4 à 6 Go. Si le disque du projet manque d'espace, placez-le ailleurs avec la variable `CARGO_TARGET_DIR` (ex. `C:\digistock-target`) ; l'installateur sera alors dans `%CARGO_TARGET_DIR%\release\bundle\nsis\`.

L'installateur NSIS (français) installe DigiStock, crée les raccourcis et télécharge WebView2 si nécessaire. Le service WhatsApp utilise Microsoft Edge, déjà présent sur Windows 10/11.

## Publier une nouvelle version (mise à jour automatique)

Depuis la 1.0.1, DigiStock vérifie au démarrage s'il existe une version plus récente sur GitHub Releases (`digistudio-dev/digistock`) et propose de l'installer (Paramètres › À propos › Mises à jour). Les mises à jour sont **signées** : l'application refuse tout paquet qui n'est pas signé par votre clé.

1. Augmentez la version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`.
2. Construisez avec la clé privée de signature (à conserver précieusement, hors du dépôt) :

```bash
TAURI_SIGNING_PRIVATE_KEY="C:/Users/PROBOOK/.tauri/digistock-updater.key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run tauri build
```

3. Préparez les fichiers de publication :

```bash
npm run release:prepare -- "Correction de la connexion WhatsApp."
```

4. Sur GitHub, créez une release nommée exactement `v<version>` (ex. `v1.0.1`) et joignez les 3 fichiers de `release/v<version>/` : l'installateur `.exe`, sa signature `.sig` et `latest.json`.

> Si la clé privée est perdue, plus aucune mise à jour automatique ne pourra être publiée pour les installations existantes : sauvegardez `digistock-updater.key` en lieu sûr.

## Tests

```bash
npm test
```

```bash
npm run test:rust
```

```bash
npm run typecheck
```

## Codes d'activation Premium

L'application contient **cinq emplacements** d'empreintes SHA-256 dans `src-tauri/src/premium_codes.rs`. Les codes en clair ne sont jamais présents dans le dépôt ni dans le JavaScript.

Générer de nouveaux codes et leurs empreintes :

```bash
npm run premium:hash -- --generate 5
```

Calculer l'empreinte d'un code existant :

```bash
npm run premium:hash -- DGS-XXXX-XXXX-XXXX-XXXX
```

Copiez les empreintes dans `premium_codes.rs`, puis reconstruisez l'application.

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — architecture, base de données, sécurité, WhatsApp, packaging, mises à jour.
- [docs/QA.md](docs/QA.md) — scénarios de recette.

© DigiStudio — [digistudio.dev](https://digistudio.dev)
