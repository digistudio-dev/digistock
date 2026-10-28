-- 1.2.0 — Licences signées (serveur de licences DigiStudio). Purement additif : aucune donnée existante n'est touchée.
-- L'activation historique (table premium_activation) est conservée telle quelle pour les clients déjà activés.

CREATE TABLE IF NOT EXISTS license_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  installation_id TEXT NOT NULL,
  certificate     TEXT,
  high_water      INTEGER NOT NULL DEFAULT 0,
  last_online_ok  INTEGER,
  denied_code     TEXT,
  state_mac       TEXT NOT NULL DEFAULT ''
);
