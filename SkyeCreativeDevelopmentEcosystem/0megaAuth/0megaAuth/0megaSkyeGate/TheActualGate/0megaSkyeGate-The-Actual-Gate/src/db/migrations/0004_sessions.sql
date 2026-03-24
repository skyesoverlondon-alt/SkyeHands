-- Migration 0004: 0s unified session store
-- Sessions issued by 0megaSkyeGate for all Sky0s platforms

CREATE TABLE IF NOT EXISTS gate_sessions (
  id            TEXT    NOT NULL PRIMARY KEY,         -- nanoid session ID (sid in JWT)
  token_hash    TEXT    NOT NULL UNIQUE,              -- SHA-256 hex of the raw session JWT
  app_id        TEXT    NOT NULL,                     -- from the underlying app_token / founder
  org_id        TEXT    NOT NULL,
  auth_mode     TEXT    NOT NULL DEFAULT '0skey',     -- '0skey' | 'founder-gateway'
  created_at    TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gate_sessions_token_hash ON gate_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_gate_sessions_app_id     ON gate_sessions (app_id);
