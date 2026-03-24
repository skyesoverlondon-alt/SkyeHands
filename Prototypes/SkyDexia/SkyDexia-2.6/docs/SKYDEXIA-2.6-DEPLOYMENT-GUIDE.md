# SkyDexia 2.6 Deployment Guide

## Purpose

This guide covers how to deploy SkyDexia 2.6 as the self-contained package that lives in this folder.

It is based on the actual package contract in this lane:
- static frontend from `index.html`
- self-hosted package server from `server.js`
- Netlify Functions from `netlify/functions`
- `/api/*` routed through `netlify.toml`
- founder-gated runtime access for workspace, AI, mail, and release actions
- founder-gated `/api/runtime/*` routes for workspace materialization, process ownership, log capture, runtime probe, restart, and stop
- GitHub push and Netlify deploy actions executed from the same saved workspace snapshot

## Package root

Deploy from this folder:

```bash
/workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
```

## What gets deployed

The package ships these deployment-relevant surfaces:

1. `index.html`
   Frontend entrypoint for the SkyDexia 2.6 browser app.
2. `_shared/auth-unlock.js`
   Browser-side auth unlock helper used by the packaged lane.
3. `netlify.toml`
   Declares publish root as `.` and functions root as `netlify/functions`, and rewrites `/api/*` to Netlify Functions.
4. `server.js`
   Self-hosted local package server that serves the static product, proxies packaged function routes, and exposes authenticated runtime routes under `/api/runtime/*`.
5. `netlify/functions/runtime/*`
   Hosted runtime bridge routes that forward `/api/runtime/*` calls into a configured runtime control plane when `SKYDEXIA_RUNTIME_CONTROL_URL` is set.
6. `package.json`
   Package-owned startup contract for `npm start` and `npm run dev`.
7. `netlify/functions/auth-founder-gateway.js`
   Issues signed runtime sessions after founder key validation.
8. `netlify/functions/ws-get.js` and `netlify/functions/ws-save.js`
   Serve and save the packaged workspace snapshot.
9. `netlify/functions/integrations-status.js`
   Returns sanitized GitHub and Netlify integration state.
10. `netlify/functions/ai-agent.js`
   Sends agent requests through 0megaSkyeGate.
11. `netlify/functions/skymail-send.js`
   Sends mail through Resend.
12. `netlify/functions/github-app-connect.js` and `netlify/functions/github-push.js`
   Validate GitHub config and push the saved workspace snapshot to GitHub.
13. `netlify/functions/netlify-connect.js` and `netlify/functions/netlify-deploy.js`
    Validate Netlify config and deploy the saved workspace snapshot as a zip.

## Architecture summary

SkyDexia 2.6 is now two deployment shapes in one package:

1. self-hosted package mode through `server.js`
2. Netlify-hosted package mode through `netlify/functions`

Request flow:

1. Browser loads `index.html`.
2. Frontend calls `/api/auth-founder-gateway` to unlock the packaged server lane.
3. The auth function returns a signed founder session cookie and a signed bearer token, but same-origin browser flows now prefer the cookie path instead of persisting a browser-readable bearer token.
4. The browser uses that session to call `/api/ws-*`, `/api/integrations-status`, `/api/ai-agent`, `/api/skymail-send`, `/api/github-*`, and `/api/netlify-*`.
5. In self-hosted package mode, the browser can call `/api/runtime/*` directly to materialize the saved workspace to disk, start a real process, stream logs, run a health probe, restart it, stop it, and reopen its runtime URL.
6. In hosted mode, `/api/runtime/*` stays live through a native hosted runtime sidecar by default and reports `runtime_lane.mode=hosted-native-runtime`.
7. If `SKYDEXIA_RUNTIME_CONTROL_URL` points at a real SkyDexia package server or equivalent runtime control endpoint, those same hosted routes can bridge runtime control instead and report `runtime_lane.mode=hosted-runtime-bridge`.
8. The workbench layer now also exposes `/api/runtime/task-*` for integrated terminal and task execution, plus reusable presets and saved `.skydexia/workbench.json` profiles for reproducible boot.
9. The self-hosted package server persists materialized workspace metadata, the last runtime launch config, the last runtime snapshot, stop-recipe config, stop outcome, workspace-scoped stdout/stderr logs, and recent task session history under `.runtime-data/local-package-server`, so runtime recovery and log inspection survive a package-server restart.
10. Release actions operate on the saved workspace snapshot, not on an unsaved browser shadow copy.
11. If GitHub or Netlify credentials are unavailable when a release is requested, SkyDexia 2.6 now records a deferred release entry instead of claiming that a remote push or deploy already happened.
12. Once those adapters or credentials are available again, deferred release entries can be replayed from the package UI or through `/api/release-replay`.

## Deployment target

The package now has a primary local runtime target and a secondary hosted release target.

Preferred target for Codespaces-class validation:

1. `server.js` owns package-local runtime/process control.
2. `package.json` exposes a clean `npm start` contract.
3. `/api/runtime/*` only exists when the self-hosted package server is running.

Secondary hosted target for packaged browser and release APIs:

1. `netlify.toml` is already present.
2. All backend release, AI, mail, and workspace routes are implemented as Netlify Functions.
3. Frontend release controls explicitly expect `/api/*` routes that map to Netlify Functions.
4. Hosted `/api/runtime/*` routes now own runtime and task execution natively by default.
5. Hosted `/api/runtime/*` routes can still bridge into an external runtime control plane when `SKYDEXIA_RUNTIME_CONTROL_URL` is configured.

Netlify remains valid for hosted deployment, but it is no longer the only meaningful package runtime. The local package server is now the critical proof path for the autonomous Codespaces-class contract.

## Required accounts and services

Before deployment, have these ready:

1. A Netlify account and target site.
2. A founder gateway key for package unlock.
3. A strong session signing secret.
4. A deployed 0megaSkyeGate endpoint and app token if you want live AI execution.
5. A Resend account and sender identity if you want live mail delivery.
6. A GitHub token if you want live GitHub push from inside SkyDexia 2.6.
7. A Netlify personal access token if you want SkyDexia 2.6 to deploy other saved workspaces from inside itself.

## Environment variables

Set these in Netlify for the SkyDexia 2.6 site.

### Required for founder unlock and signed sessions

1. `FOUNDERS_GATEWAY_KEY` or `Founders_GateWay_Key`
   Shared secret entered by the founder to activate the packaged server lane.
2. `SKYDEXIA_SESSION_SECRET`
   Strong random secret used to sign runtime bearer tokens and seal stored provider tokens.

Important:

1. Founder unlock fails closed if no session secret is configured.
2. The runtime also uses this secret to encrypt stored GitHub and Netlify tokens server-side.
3. Use a long random value, not a site id, label, or predictable phrase.
4. The browser no longer fabricates a local founder-success path when the packaged auth lane is unavailable; `/api/auth-founder-gateway` must succeed for founder unlock to become active.

### Required for live AI execution

1. `OMEGA_GATE_URL`
   Base URL for the deployed 0megaSkyeGate service.
2. `KAIXU_APP_TOKEN`
   Server-side token used when SkyDexia 2.6 calls the gate.

Optional AI tuning variables supported by the code:

1. `KAIXU_AGENT_MODEL`
2. `OPENAI_AGENT_MODEL`
3. `KAIXU_REASONING_EFFORT`
4. `OPENAI_REASONING_EFFORT`
5. `KAIXU_AGENT_PROVIDER`

### Required for live mail delivery

1. `RESEND_API_KEY`
2. `SKYDEXIA_MAIL_FROM`

Accepted fallbacks for sender address:

1. `SKYDEX_MAIL_FROM`
2. `RESEND_FROM_EMAIL`

### Required for env-only GitHub push execution

At least one of:

1. `SKYDEXIA_GITHUB_TOKEN`
2. `GITHUB_TOKEN`
3. `GH_TOKEN`

If you do not set one of these, SkyDexia 2.6 can still work if you connect a GitHub token through the browser UI and let the server lane seal and store it.

If neither an env token nor a vaulted GitHub token is available at push time, the product records a deferred GitHub release entry that remains inspectable from the package UI.

### Required for env-only Netlify deploy execution

At least one of:

1. `SKYDEXIA_NETLIFY_TOKEN`
2. `NETLIFY_AUTH_TOKEN`
3. `NETLIFY_TOKEN`

If you do not set one of these, SkyDexia 2.6 can still work if you connect a Netlify token through the browser UI and let the server lane seal and store it.

If neither an env token nor a vaulted Netlify token is available at deploy time, the product records a deferred Netlify release entry that remains inspectable from the package UI.

### Optional durable hosted package state

1. `SKYDEXIA_DATABASE_URL`
   Postgres connection string used by the packaged function lane for durable hosted workspace, integration, SkyeDrive, notification, and release state.
2. `SKYDEXIA_DATABASE_TABLE`
   Optional override for the shared state table name.
3. `SKYDEXIA_DATABASE_SSL=require`
   Optional switch for hosted Postgres providers that require TLS.

If `SKYDEXIA_DATABASE_URL` is absent, the hosted function lane falls back to file-backed package state. If it is present, the packaged lane reports `storage_backend=postgres` through `/api/integrations-status` and persists shared state in Postgres instead of the function filesystem.

### Optional hosted runtime bridge

1. `SKYDEXIA_RUNTIME_CONTROL_URL`
   Base URL for a reachable SkyDexia package server or equivalent runtime control endpoint that exposes `/api/runtime/*`.

If this env is present, hosted `/api/runtime/*` requests will bridge runtime list/materialize/start/restart/stop/logs/probe and task-list/task-start/task-stop/task-logs calls into that control plane and return `runtime_lane.mode=hosted-runtime-bridge` to the browser.

If this env is absent, the hosted lane boots its own native runtime sidecar and returns `runtime_lane.mode=hosted-native-runtime` instead.

### Optional founder identity display

1. `FOUNDERS_GATEWAY_EMAIL` or `Founders_GateWay_Email`

If omitted, the runtime falls back to `founder@skydexia.local`.

## Minimum production env set

If you want the packaged server lane to work but do not yet need AI, mail, or release integrations, the minimum useful production env set is:

```env
FOUNDERS_GATEWAY_KEY=your-founder-key
SKYDEXIA_SESSION_SECRET=replace-with-a-long-random-secret
```

That enables founder unlock and signed access to the packaged workspace and integration routes.

For local operator inspection before deployment or during incident checks, run `npm run inspect:storage` from the package root to print the resolved storage backend, package data root, and configured state table.

For hosted durability and hosted runtime proof before promotion, run `npm run verify:hosted` from the package root. It asserts `storage_backend=postgres`, cold-start persistence, hosted native runtime availability, hosted task execution, and graceful stop evidence.

## Full production env example

```env
FOUNDERS_GATEWAY_KEY=replace-with-founder-key
FOUNDERS_GATEWAY_EMAIL=founder@yourdomain.com
SKYDEXIA_SESSION_SECRET=replace-with-a-long-random-secret

OMEGA_GATE_URL=https://your-omega-gate.example.com
KAIXU_APP_TOKEN=replace-with-gate-token
KAIXU_AGENT_MODEL=kaixu/deep
KAIXU_REASONING_EFFORT=high

RESEND_API_KEY=replace-with-resend-key
SKYDEXIA_MAIL_FROM=SkyDexia 2.6 <notify@yourdomain.com>

SKYDEXIA_GITHUB_TOKEN=replace-with-github-token
SKYDEXIA_NETLIFY_TOKEN=replace-with-netlify-token
```

## Netlify site configuration

Create or choose a Netlify site, then configure it like this:

1. Base directory:
   `/workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6`
2. Publish directory:
   `.`
3. Functions directory:
   `netlify/functions`
4. Build command:
   none required for this package as currently structured

This matches `netlify.toml`:

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

## Deployment methods

There are two sensible deployment methods.

### Method 1: direct folder deploy in Netlify

Use this when you want to deploy the package folder directly.

1. Open Netlify.
2. Create a new site or pick the existing SkyDexia 2.6 site.
3. Point Netlify at the SkyDexia 2.6 folder.
4. Apply the environment variables listed above.
5. Trigger deploy.

### Method 2: Git-backed deploy

Use this when you want Netlify deployments to follow a repository branch.

1. Put the SkyDexia 2.6 folder in a Git repository layout you control.
2. In Netlify, connect the repo.
3. Set the base directory to the SkyDexia 2.6 folder.
4. Leave build command empty unless you later add a build step.
5. Set publish directory to `.`.
6. Set functions directory to `netlify/functions`.
7. Add the environment variables.
8. Deploy the selected branch.

## Local pre-deploy smoke test

Run both of these before deploying.

### Local package server smoke

```bash
cd /workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm start
```

Expected result:

1. The UI loads through the package-owned server.
2. Founder unlock works if env vars are set locally.
3. `/api/runtime/list`, `/api/runtime/materialize`, `/api/runtime/start`, `/api/runtime/logs`, `/api/runtime/probe`, `/api/runtime/restart`, and `/api/runtime/stop` are available.
4. SkyDexia can materialize the saved workspace, launch a real runtime process, expose the launch URL, capture logs, and recover the runtime without depending on a larger host shell.
5. After a package-server restart, `/api/runtime/list` still returns the last saved runtime launch config and stopped-runtime snapshot, and `/api/runtime/start` can relaunch from that persisted config without re-entering the command.

### Package verify smoke

```bash
cd /workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify
```

Expected result:

1. Founder auth returns `200` from the self-hosted package server.
2. Workspace save, runtime materialize, runtime start, runtime probe, and runtime stop all succeed through the package API.
3. GitHub push and Netlify deploy both return `202` with `deferred=true` when no release credentials are configured.
4. `integrations-status` reports two deferred release entries for the isolated verify workspace.
5. `release-replay` accepts one of those deferred entries and returns a truthful replay response from the package lane.

### Static smoke

```bash
cd /workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
python3 -m http.server 4192
```

Expected result:

1. The UI loads.
2. Standalone browser fallback works.
3. Founder-gated server routes will not be live in this mode.
4. This mode is not sufficient proof for the Codespaces-class runtime contract because `/api/runtime/*` is unavailable.

### Netlify local smoke

```bash
cd /workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npx netlify-cli dev
```

Expected result:

1. The UI loads through Netlify local dev.
2. `/api/auth-founder-gateway` exists.
3. Founder unlock works if env vars are set locally.
4. Workspace, integration, AI, mail, GitHub, and Netlify server routes are reachable according to configured env.

## First production deploy checklist

1. Confirm the package root is correct.
2. Confirm `netlify.toml` is included.
3. Set `FOUNDERS_GATEWAY_KEY`.
4. Set `SKYDEXIA_SESSION_SECRET`.
5. Deploy the site.
6. Open the deployed URL.
7. Click or trigger Founder Quick Unlock.
8. Enter the founder key.
9. Confirm unlock succeeds.
10. Confirm workspace save and reload work.

After that, add the optional live integrations one by one.

## Post-deploy validation sequence

Validate in this order.

### Phase 1: auth boundary

1. Load the site.
2. Trigger Founder Quick Unlock.
3. Enter the founder key.
4. Confirm the UI reflects founder-unlocked state.
5. Confirm protected routes no longer return `401`.

If this fails:

1. Check `FOUNDERS_GATEWAY_KEY`.
2. Check `SKYDEXIA_SESSION_SECRET`.
3. Confirm the deployed function is receiving the env vars.

### Phase 2: workspace persistence route

1. Save a small workspace snapshot.
2. Reload the app.
3. Confirm `/api/ws-get` returns the same snapshot.
4. Confirm `/api/integrations-status` responds after unlock.

### Phase 3: AI lane

1. Set `OMEGA_GATE_URL`.
2. Set `KAIXU_APP_TOKEN`.
3. Unlock founder session.
4. Run a minimal prompt through the agent.
5. Confirm `/api/ai-agent` returns a structured JSON response.

If this fails:

1. Check that the gate URL is correct.
2. Check that the app token is valid.
3. Check whether the gate is expecting a different route shape.

### Phase 4: mail lane

1. Set `RESEND_API_KEY`.
2. Set `SKYDEXIA_MAIL_FROM`.
3. Unlock founder session.
4. Send a test email.
5. Confirm provider success response.

### Phase 5: GitHub release lane

1. Unlock founder session.
2. Connect a repo in `owner/repo` format.
3. Supply a branch.
4. Supply a GitHub token in env or via the UI connect flow.
5. Save the workspace.
6. Run Save Then Push.
7. Confirm a commit SHA is returned.
8. Confirm the branch update exists in GitHub.

### Phase 6: Netlify release lane

1. Unlock founder session.
2. Connect a Netlify site id or site name.
3. Supply a Netlify token in env or via the UI connect flow.
4. Save the workspace.
5. Run Save Then Deploy.
6. Confirm a deploy id and URL are returned.
7. Open the returned deploy URL.

## How release actions work

This matters operationally.

SkyDexia 2.6 does not push or deploy arbitrary unsaved browser state. The intended sequence is:

1. Edit the workspace.
2. Save the workspace snapshot through `/api/ws-save`.
3. Optionally sync to SkyeDrive.
4. Push to GitHub from that saved snapshot.
5. Deploy to Netlify from that same saved snapshot.

That behavior is part of the package contract and is consistent with the frontend copy and server handlers.

## GitHub connection details

The GitHub connect handler expects:

1. `repo` in `owner/repo` form
2. `branch`, defaulting to `main`
3. optional `installation_id`
4. optional `token`

The connect route validates the repository if a token is available.

The push route:

1. loads the saved workspace snapshot
2. filters files through SKNore release rules
3. creates Git blobs and a Git tree through the GitHub API
4. creates a commit
5. updates the target branch or creates it if missing

## Netlify connection details

The Netlify connect handler expects:

1. `site_id` or `site_name`
2. optional `token`

The deploy route:

1. loads the saved workspace snapshot
2. filters files through SKNore release rules
3. creates an in-memory zip of releasable files
4. posts that zip to Netlify Deploys API
5. stores release history in package runtime state

## SKNore release filtering

Release actions do not blindly ship every file.

The runtime excludes paths matching sensitive patterns such as:

1. `.env`
2. `secret`
3. `private_key`
4. `id_rsa`
5. `.pem`
6. `.p12`
7. `.crt`
8. `credentials`
9. `service-account`

Operational consequence:

1. GitHub push and Netlify deploy may exclude files you expected to ship.
2. If the excluded file is required at runtime, the release will be incomplete.
3. Review the SKNore preview before push or deploy.

## Hosted Netlify persistence limitation

This is the main caveat for the Netlify-hosted shape.

It does not block the self-hosted package-server path that SkyDexia 2.6 now uses for Codespaces-class validation. In self-hosted package mode, the package owns its runtime/process lane directly on the host filesystem.

The packaged runtime persists workspace and integration state to a local JSON file under:

```text
netlify/.runtime-data/skydexia-2.6.json
```

More precisely, the functions runtime writes to a sibling `.runtime-data` directory under `netlify/functions/..`, which resolves inside the deployed function filesystem.

In self-hosted package mode, you can override that state root with `SKYDEXIA_DATA_DIR=/absolute/path` before running `npm start`. The package server and packaged functions will then keep workspace state, integration state, deferred release queue/history, runtime recovery metadata, and persisted runtime logs under that mounted path.

SkyDexia 2.6 now also supports a durable hosted persistence path: set `SKYDEXIA_DATABASE_URL` to a Postgres connection string and the packaged function lane will store workspace state, integration state, SkyeDrive continuity records, notifications, and release queue/history in Postgres instead of the ephemeral function filesystem. Optional envs: `SKYDEXIA_DATABASE_TABLE` to override the table name and `SKYDEXIA_DATABASE_SSL=require` when your hosted provider requires TLS.

That means the runtime-file path is no longer the only production option. It remains acceptable for local development, smoke tests, and self-hosted package lanes that already mount `SKYDEXIA_DATA_DIR`, but the recommended hosted production path is now the Postgres-backed adapter.

What this means in practice:

1. Saved workspace snapshots may not survive cold starts, redeploys, or scaling behavior the way you expect.
2. Connected integration state may be lost.
3. Release history stored in the runtime file should be treated as best-effort, not authoritative production evidence.

Recommended hosted production path:

1. Set `SKYDEXIA_DATABASE_URL` to a durable Postgres service such as Neon, Supabase Postgres, or another managed Postgres deployment.
2. Keep the current Netlify Functions API shape; SkyDexia 2.6 now swaps the backing state implementation automatically when that env is present.
3. Keep `SKYDEXIA_DATA_DIR` for self-hosted runtime evidence if you also want the local package server lane to write under a mounted durable host path.

If you deploy the hosted Netlify shape today without setting `SKYDEXIA_DATABASE_URL`, treat that deployment as production-like for UI and route behavior, not as durable authoritative storage.

## Security guidance

1. Do not hardcode any of the secrets into `index.html` or checked-in files.
2. Use a unique `SKYDEXIA_SESSION_SECRET` per environment.
3. Rotate provider tokens if they were ever exposed during testing.
4. Prefer connecting provider tokens through the UI only on a trusted founder session.
5. Restrict GitHub tokens to the minimum repo scope required.
6. Restrict Netlify tokens to the minimum site scope required.
7. Verify your Resend sender identity before enabling live mail.

## Troubleshooting

### Founder unlock returns 500

Cause:

1. `SKYDEXIA_SESSION_SECRET` is missing.

Fix:

1. Add `SKYDEXIA_SESSION_SECRET` in Netlify env.
2. Redeploy or trigger a function environment refresh.

### Founder unlock returns 401

Cause:

1. Founder key mismatch.

Fix:

1. Check the entered key.
2. Check `FOUNDERS_GATEWAY_KEY`.

### AI route returns 500

Cause:

1. `OMEGA_GATE_URL` missing.
2. `KAIXU_APP_TOKEN` missing.
3. Upstream gate unavailable.

Fix:

1. Set the missing env.
2. Verify upstream gate health.

### Mail route returns 500

Cause:

1. `RESEND_API_KEY` missing.
2. Sender address env missing.

Fix:

1. Add `RESEND_API_KEY`.
2. Add `SKYDEXIA_MAIL_FROM`.

### GitHub connect or push fails

Cause:

1. Bad repo format.
2. Missing token.
3. Token lacks repo access.
4. Branch protection blocks update.

Fix:

1. Use `owner/repo` format.
2. Provide a valid token.
3. Check repo permission scope.
4. Push to an allowed branch or adjust branch policy.

### Netlify connect or deploy fails

Cause:

1. Missing site id and site name.
2. Token lacks site access.
3. Configured site not found for token.

Fix:

1. Provide a valid `site_id` or `site_name`.
2. Provide a valid Netlify token.
3. Reconnect the site through the UI or env.

## Recommended rollout order

Use this order instead of turning everything on at once.

1. Deploy static frontend plus founder unlock only.
2. Validate workspace save and reload.
3. Add AI env and validate `ai-agent`.
4. Add Resend env and validate mail.
5. Add GitHub connection and validate push.
6. Add Netlify connection and validate deploy.
7. Add `SKYDEXIA_DATABASE_URL` when you need durable hosted state and confirm the hosted lane reports `storage_backend=postgres`.

## Definition of successful deployment

A successful SkyDexia 2.6 deployment means all of these are true:

1. The site loads from Netlify.
2. Founder unlock succeeds using the configured founder key.
3. Signed session-gated routes return successfully after unlock.
4. Workspace save and reload work.
5. AI, mail, GitHub, and Netlify actions work for the integrations you enabled.
6. Release actions operate on the saved workspace snapshot.
7. You can identify which state backend is active through `/api/integrations-status`, the release queue panel, or `npm run inspect:storage`, and hosted deployments use Postgres when `SKYDEXIA_DATABASE_URL` is configured.

## Source references

Deployment behavior in this guide is derived from these package files:

1. `README.md`
2. `package.json`
3. `server.js`
4. `netlify.toml`
5. `netlify/functions/_lib/runtime.js`
6. `netlify/functions/auth-founder-gateway.js`
7. `netlify/functions/ws-get.js`
8. `netlify/functions/ws-save.js`
9. `netlify/functions/integrations-status.js`
10. `netlify/functions/ai-agent.js`
11. `netlify/functions/skymail-send.js`
12. `netlify/functions/github-app-connect.js`
13. `netlify/functions/github-push.js`
14. `netlify/functions/netlify-connect.js`
15. `netlify/functions/netlify-deploy.js`
16. `docs/SKYDEXIA-2.6-SELF-CONTAINED-CONTRACT.md`