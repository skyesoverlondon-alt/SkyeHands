PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  key_name TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE TABLE IF NOT EXISTS model_aliases (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  task_type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE INDEX IF NOT EXISTS idx_model_aliases_alias_priority ON model_aliases(alias, priority);

CREATE TABLE IF NOT EXISTS alias_pricing (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  base_burn INTEGER NOT NULL DEFAULT 1,
  input_token_rate REAL NOT NULL DEFAULT 0.001,
  output_token_rate REAL NOT NULL DEFAULT 0.001,
  image_rate REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  org_id TEXT,
  app_id TEXT,
  strategy TEXT NOT NULL,
  max_budget_per_call INTEGER,
  allow_fallback INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SKYFUEL',
  balance INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_scope ON wallets(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  trace_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id, created_at);

CREATE TABLE IF NOT EXISTS app_tokens (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  allowed_aliases TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  rate_limit_rpm INTEGER,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_tokens_token_hash ON app_tokens(token_hash);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  org_id TEXT,
  app_id TEXT,
  user_id TEXT,
  wallet_id TEXT,
  alias TEXT NOT NULL,
  provider TEXT,
  resolved_model TEXT,
  request_type TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  skyfuel_burned INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_app_id ON usage_events(app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_wallet_id ON usage_events(wallet_id, created_at);

CREATE TABLE IF NOT EXISTS fallback_logs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  from_provider TEXT,
  from_model TEXT,
  to_provider TEXT,
  to_model TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
