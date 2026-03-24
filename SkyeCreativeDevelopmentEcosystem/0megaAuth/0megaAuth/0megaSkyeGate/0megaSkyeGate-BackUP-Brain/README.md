# 0megaSkyeGate Backup Brain

This worker is the founder fallback target for 0megaSkyeGate.

## Endpoints

- POST /v1/brain/backup/generate
- POST /v1/brain/backup/generate-stream
- GET /health

Both backup endpoints require a bearer token. By default the worker accepts BACKUP_BRAIN_RUNNER_TOKEN when set, otherwise it falls back to KAIXU_BACKUP_TOKEN or KAIXU_APP_TOKEN.

## Required environment

- KAIXU_BACKUP_ENDPOINT
- one of KAIXU_BACKUP_UPSTREAM_TOKEN, KAIXU_BACKUP_TOKEN, or KAIXU_APP_TOKEN

## Local dev

1. npm install
2. copy .dev.vars.example to .dev.vars and fill values
3. npm run dev

## Contract

The response shape is normalized for the internal gate:

- success: ok, text, brain, usage
- failure: ok=false, error, brain

Streaming responses proxy text/event-stream when the upstream supports it.