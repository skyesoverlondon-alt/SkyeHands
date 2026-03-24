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
  upstream_cost_usd REAL NOT NULL DEFAULT 0,
  billed_cost_usd REAL NOT NULL DEFAULT 0,
  markup_multiplier REAL NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS kaixu_traces (
  trace_id TEXT PRIMARY KEY,
  job_id TEXT,
  app_id TEXT,
  user_id TEXT,
  org_id TEXT,
  lane TEXT NOT NULL,
  engine_alias TEXT NOT NULL,
  public_status TEXT NOT NULL,
  upstream_vendor TEXT,
  upstream_model TEXT,
  input_size_estimate INTEGER,
  output_size_estimate INTEGER,
  usage_json TEXT,
  latency_ms INTEGER,
  public_response_json TEXT,
  public_error_code TEXT,
  public_error_message TEXT,
  request_method TEXT,
  request_path TEXT,
  internal_response_json TEXT,
  internal_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kaixu_traces_app_id ON kaixu_traces(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kaixu_traces_job_id ON kaixu_traces(job_id);

CREATE TABLE IF NOT EXISTS kaixu_jobs (
  job_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  app_id TEXT,
  user_id TEXT,
  org_id TEXT,
  lane TEXT NOT NULL,
  engine_alias TEXT NOT NULL,
  status TEXT NOT NULL,
  upstream_vendor TEXT,
  upstream_model TEXT,
  upstream_job_id TEXT,
  request_json TEXT,
  result_json TEXT,
  asset_refs TEXT,
  error_code TEXT,
  error_message TEXT,
  admin_error_raw TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_kaixu_jobs_trace_id ON kaixu_jobs(trace_id);
CREATE INDEX IF NOT EXISTS idx_kaixu_jobs_app_id ON kaixu_jobs(app_id, created_at DESC);
