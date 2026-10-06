-- 1.0.2 — Envoi WhatsApp par lien officiel (wa.me) : nouveau statut « opened »
-- (message préparé et ouvert dans WhatsApp, envoyé par l'utilisateur).
-- SQLite ne permet pas de modifier une contrainte CHECK : on reconstruit la table.

CREATE TABLE whatsapp_messages_new (
  id             INTEGER PRIMARY KEY,
  recipient_name TEXT,
  phone          TEXT NOT NULL,
  message        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  entity         TEXT,
  entity_id      INTEGER,
  attachment     TEXT,
  status         TEXT NOT NULL CHECK (status IN ('sent','failed','opened')),
  error          TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT INTO whatsapp_messages_new
  SELECT id, recipient_name, phone, message, kind, entity, entity_id, attachment, status, error, user_id, created_at
  FROM whatsapp_messages;

DROP TABLE whatsapp_messages;
ALTER TABLE whatsapp_messages_new RENAME TO whatsapp_messages;
CREATE INDEX ix_whatsapp_created ON whatsapp_messages(created_at);
