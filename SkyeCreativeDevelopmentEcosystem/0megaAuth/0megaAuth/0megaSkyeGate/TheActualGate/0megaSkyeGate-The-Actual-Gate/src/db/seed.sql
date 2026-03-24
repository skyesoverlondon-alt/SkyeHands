DELETE FROM fallback_logs;
DELETE FROM usage_events;
DELETE FROM wallet_transactions;
DELETE FROM app_tokens;
DELETE FROM routing_rules;
DELETE FROM alias_pricing;
DELETE FROM model_aliases;
DELETE FROM provider_keys;
DELETE FROM providers;
DELETE FROM wallets;

INSERT INTO providers (id, name, enabled, created_at) VALUES
('prov_openai', 'openai', 1, '2026-03-13T00:00:00.000Z'),
('prov_gemini', 'gemini', 1, '2026-03-13T00:00:00.000Z'),
('prov_anthropic', 'anthropic', 1, '2026-03-13T00:00:00.000Z');

INSERT INTO provider_keys (id, provider_id, key_name, secret_ref, enabled, created_at) VALUES
('pkey_openai', 'prov_openai', 'OPENAI_API_KEY', 'OPENAI_API_KEY', 1, '2026-03-13T00:00:00.000Z'),
('pkey_gemini', 'prov_gemini', 'GEMINI_API_KEY', 'GEMINI_API_KEY', 1, '2026-03-13T00:00:00.000Z'),
('pkey_anthropic', 'prov_anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', 1, '2026-03-13T00:00:00.000Z');

INSERT INTO wallets (id, scope_type, scope_id, currency, balance, status, created_at) VALUES
('wallet_superide', 'app', 'superide', 'SKYFUEL', 50000, 'active', '2026-03-13T00:00:00.000Z');

INSERT INTO app_tokens (id, app_id, org_id, wallet_id, token_hash, allowed_aliases, enabled, rate_limit_rpm, created_at) VALUES
(
  'apptok_superide',
  'superide',
  'org_skyes',
  'wallet_superide',
  'ecf34f4205ca6a4f5f6b623b4a34c0d7f4755d5bf4e2f75aab67f2ed32de8f55',
  '["kaixu/flash","kaixu/deep","kaixu/code","kaixu/vision","kaixu/embed"]',
  1,
  120,
  '2026-03-13T00:00:00.000Z'
);

INSERT INTO model_aliases (id, alias, task_type, provider_id, provider_model, priority, enabled, created_at) VALUES
('alias_fast_1', 'kaixu/flash', 'chat', 'prov_gemini', 'gemini-2.5-flash', 1, 1, '2026-03-13T00:00:00.000Z'),
('alias_fast_2', 'kaixu/flash', 'chat', 'prov_openai', 'gpt-5.4-mini', 2, 1, '2026-03-13T00:00:00.000Z'),
('alias_deep_1', 'kaixu/deep', 'chat', 'prov_openai', 'gpt-5.4', 1, 1, '2026-03-13T00:00:00.000Z'),
('alias_deep_2', 'kaixu/deep', 'chat', 'prov_anthropic', 'claude-sonnet-4.6', 2, 1, '2026-03-13T00:00:00.000Z'),
('alias_code_1', 'kaixu/code', 'chat', 'prov_openai', 'gpt-5.2-codex', 1, 1, '2026-03-13T00:00:00.000Z'),
('alias_code_2', 'kaixu/code', 'chat', 'prov_anthropic', 'claude-opus-4.6', 2, 1, '2026-03-13T00:00:00.000Z'),
('alias_vision_1', 'kaixu/vision', 'chat', 'prov_gemini', 'gemini-2.5-flash', 1, 1, '2026-03-13T00:00:00.000Z'),
('alias_vision_2', 'kaixu/vision', 'chat', 'prov_openai', 'gpt-5.4', 2, 1, '2026-03-13T00:00:00.000Z'),
('alias_embed_1', 'kaixu/embed', 'embeddings', 'prov_openai', 'text-embedding-3-large', 1, 1, '2026-03-13T00:00:00.000Z'),
('alias_embed_2', 'kaixu/embed', 'embeddings', 'prov_gemini', 'gemini-embedding-2-preview', 2, 1, '2026-03-13T00:00:00.000Z');

INSERT INTO alias_pricing (id, alias, base_burn, input_token_rate, output_token_rate, image_rate, enabled, created_at) VALUES
('price_fast', 'kaixu/flash', 2, 0.002, 0.004, 0, 1, '2026-03-13T00:00:00.000Z'),
('price_deep', 'kaixu/deep', 8, 0.006, 0.012, 0, 1, '2026-03-13T00:00:00.000Z'),
('price_code', 'kaixu/code', 10, 0.007, 0.014, 0, 1, '2026-03-13T00:00:00.000Z'),
('price_vision', 'kaixu/vision', 12, 0.008, 0.010, 8, 1, '2026-03-13T00:00:00.000Z'),
('price_embed', 'kaixu/embed', 1, 0.0015, 0, 0, 1, '2026-03-13T00:00:00.000Z');

INSERT INTO routing_rules (id, alias, org_id, app_id, strategy, max_budget_per_call, allow_fallback, enabled, created_at) VALUES
('route_fast_superide', 'kaixu/flash', 'org_skyes', 'superide', 'cost_first', 20, 1, 1, '2026-03-13T00:00:00.000Z'),
('route_deep_superide', 'kaixu/deep', 'org_skyes', 'superide', 'quality_first', 60, 1, 1, '2026-03-13T00:00:00.000Z'),
('route_code_superide', 'kaixu/code', 'org_skyes', 'superide', 'quality_first', 75, 1, 1, '2026-03-13T00:00:00.000Z'),
('route_vision_superide', 'kaixu/vision', 'org_skyes', 'superide', 'quality_first', 80, 1, 1, '2026-03-13T00:00:00.000Z'),
('route_embed_superide', 'kaixu/embed', 'org_skyes', 'superide', 'cost_first', 25, 1, 1, '2026-03-13T00:00:00.000Z');
