# Kaixu Sovereign Multimodal Gateway Patch Pack

This additive pack hardens the existing Kaixu gateway into a lane-aware multimodal control surface.

## What changed

- Added distinct public Kaixu lanes for chat, stream, images, videos, speech, transcriptions, realtime, usage, and jobs.
- Added first-class `kaixu_traces` and `kaixu_jobs` tables for trace/job observability.
- Split OpenAI adapter code by lane instead of pretending one generic handler can do all the weird little circus acts.
- Normalized public responses so provider/model/upstream details stay admin-only.
- Added admin routes for trace inspection, job inspection, upstream inspection, retry, and cancel.
- Added separate async video polling behavior to avoid query-racing between direct-response lanes and background job lanes.

## Key files

- `src/router.ts`
- `src/routes/*.ts`
- `src/adapters/*.ts`
- `src/db/migrations/0002_multimodal_hardening.sql`
- `docs/api-contract.md`
- `docs/env-example.md`
- `docs/acceptance-checklist.md`
- `docs/integration-readme.md`

## Deploy notes

1. Apply the D1 migration.
2. Set Worker secrets for the OpenAI key(s) and `KAIXU_ADMIN_TOKEN`.
3. Set or confirm enabled lane vars.
4. Deploy the worker.
5. Point frontend apps at Kaixu routes only.

## Typecheck

```bash
npm install
npm run typecheck
```
