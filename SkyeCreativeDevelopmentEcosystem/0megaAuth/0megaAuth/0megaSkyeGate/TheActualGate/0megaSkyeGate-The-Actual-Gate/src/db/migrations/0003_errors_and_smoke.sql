-- Migration 0003: SkyeErrors events table + app_tokens created_at index
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skye_errors_events (
  event_id       TEXT PRIMARY KEY,
  tenant_key     TEXT NOT NULL,
  tenant_label   TEXT,
  ts_ms          INTEGER NOT NULL,
  level          TEXT,
  name           TEXT,
  message        TEXT,
  fingerprint    TEXT,
  request_method TEXT,
  request_url    TEXT,
  cf_ray         TEXT,
  release        TEXT,
  environment    TEXT,
  app            TEXT,
  raw_r2_key     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skye_errors_tenant_ts
  ON skye_errors_events(tenant_key, ts_ms DESC);

CREATE INDEX IF NOT EXISTS idx_skye_errors_ts
  ON skye_errors_events(ts_ms DESC);

CREATE INDEX IF NOT EXISTS idx_skye_errors_fingerprint
  ON skye_errors_events(tenant_key, fingerprint);
