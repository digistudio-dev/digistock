-- 1.1.0 — Code PIN à 4 chiffres et questions de sécurité (réinitialisation du mot de passe).
-- Le PIN et les réponses sont hachés (Argon2id), jamais stockés en clair.

ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN pin_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN recovery_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN recovery_locked_until TEXT;

CREATE TABLE user_security_questions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  question    TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (user_id, position)
);
