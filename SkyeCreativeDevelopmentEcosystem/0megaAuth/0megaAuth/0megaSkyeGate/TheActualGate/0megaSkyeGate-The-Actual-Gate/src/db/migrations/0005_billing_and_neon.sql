-- Migration 0005: dual-cost billing ledger for 0sKey + Neon mirror support

ALTER TABLE usage_events ADD COLUMN upstream_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN billed_cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN markup_multiplier REAL NOT NULL DEFAULT 1;