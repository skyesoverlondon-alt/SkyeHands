PRAGMA foreign_keys = ON;

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
