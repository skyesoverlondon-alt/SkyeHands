# SkyDexia 2.6

SkyDexia 2.6 is the product-first SkyDex package inside the SkyeCDE tree.

This folder no longer points at the earlier reset scaffold. It now boots from the copied original SkyDex product surface, rebranded under SkyDexia 2.6 identity and hardened for standalone export.

## Purpose

SkyDexia 2.6 is intended to be:
- a self-contained workspace-aware autonomous IDE
- a bounded agent surface with explicit controlled and autonomous modes
- a release lane that saves, mirrors, pushes, and deploys from the same workspace state
- a portable folder that still boots outside the larger SkyeCDE environment
- a package that auto-attaches to shared SkyeCDE services when those services are present

## Shipped package contents

- `index.html`
  - the real product entrypoint copied from original SkyDex and upgraded to SkyDexia 2.6 identity
- `_shared/auth-unlock.js`
  - local auth unlock stub so the package does not depend on a repo-root shared path
- `_shared/standalone-session.js`
  - local standalone session runtime with SkyDexia 2.6 intent logging namespace
- `netlify.toml`
  - static publish plus function routing for `/api/*`
- `server.js`
  - self-hosted package server that serves the product, proxies the existing function lane, and adds authenticated runtime materialize/start/logs/probe/restart/stop routes
- `package.json`
  - package-owned startup contract so the lane boots with `npm start` or `npm run dev`
- `netlify/functions/ai-agent.js`
  - live 0megaSkyeGate-backed structured agent endpoint for SkyDexia 2.6
- `netlify/functions/skymail-send.js`
  - live Resend-backed delivery endpoint with `SKYDEXIA_MAIL_FROM` support
- `netlify/functions/auth-founder-gateway.js`
  - packaged founder unlock endpoint that issues a signed SkyDexia 2.6 runtime session
- `netlify/functions/ws-get.js`, `ws-save.js`, `integrations-status.js`
  - packaged workspace snapshot and integration-state persistence lane
- `netlify/functions/skyedrive-source-list.js`, `skyedrive-source-open.js`, `skyedrive-push.js`
  - packaged SkyeDrive source registry, restore-point, and mirror persistence lane
- `netlify/functions/sknore-release-preview.js`, `app-record-list.js`, `skychat-notify.js`
  - packaged release preview, record recall, and notification queue endpoints
- `netlify/functions/github-app-connect.js`, `github-push.js`, `netlify-connect.js`, `netlify-deploy.js`
  - packaged GitHub and Netlify release endpoints with validated server-side integration state, sealed provider token vaulting, credential-aware execution, and persisted release history
- `docs/SKYDEXIA-2.6-AUTONOMY-AUDIT.md`
  - architecture audit explaining why this lane had to be rebuilt from the original SkyDex contract
- `docs/SKYDEXIA-2.6-SELF-CONTAINED-CONTRACT.md`
  - the independent-boot and auto-attach contract for this package
- `What She Needs To Beat CodeSpaces`
  - explicit verdict on current Codespaces parity, checklist of what is already real, and a file-by-file plan for the missing work
- `TEST_REPORT.md`
  - current verification notes for standalone boot and edited runtime files

## Runtime contract

Standalone mode keeps these surfaces alive:
- local workspace snapshot save and reload
- restore-point and SkyeDrive-style local fallback recording
- bounded agent UI and operation staging contract
- GitHub and Netlify integration continuity through deferred local release records when live release credentials are absent
- local release evidence and suite-intent logging

Standalone fallback is only used when the packaged server lane is unavailable, such as local static serving without Netlify functions. If the live server lane responds with an auth failure or runtime error, SkyDexia 2.6 now surfaces that failure instead of silently converting it into a fake local success. GitHub and Netlify fallback now record deferred local release intents instead of inventing a pushed commit or deploy id.

Connected mode upgrades those same surfaces with:
- live `npm start` / `node server.js` package boot for static serving plus authenticated local runtime ownership
- live `/api/auth-founder-gateway` founder unlock for packaged owner-session continuity
- live `/api/ws-get`, `/api/ws-save`, `/api/integrations-status`, and `/api/skyedrive-*` persistence inside the exported package
- founder/session-gated read access for workspace snapshots, integration state, SkyeDrive records, and recalled package records
- founder/session-gated `/api/sknore-release-preview`, `/api/github-*`, `/api/netlify-*`, and `/api/skychat-notify` execution and queue surfaces inside the exported package
- founder/session-gated live `/api/ai-agent` routing through 0megaSkyeGate
- founder/session-gated live `/api/skymail-send` delivery
- browser-side GitHub and Netlify connect flows that validate the target integration and vault provider tokens into the packaged server lane
- real GitHub push and Netlify deploy when the runtime env or vaulted provider credentials are configured, with deferred release queue records when those adapters are unavailable
- replayable deferred GitHub and Netlify release records when those adapters become available later in the same package lane
- package-owned workspace materialization, process start, URL exposure, log capture, probe, restart, and stop through `/api/runtime/*`
- hosted runtime control through `netlify/functions/runtime/*` when `SKYDEXIA_RUNTIME_CONTROL_URL` is configured to bridge hosted requests into a real SkyDexia runtime control plane

## Quick start

Primary self-hosted package serve from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm start
```

This is the preferred local mode when validating SkyDexia as a Codespaces-class package replacement because it exposes the package-owned runtime/process lane.

Package-owned contract smoke from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify
```

This runs a self-hosted package smoke that proves founder auth, workspace save, runtime materialization/start/probe/stop, and truthful deferred GitHub and Netlify release recording from the package lane itself.

Hosted durable-state and runtime-bridge smoke from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:hosted
```

This runs a hosted-shape smoke that proves `storage_backend=postgres`, cold-start durability for workspace/integration/release state, hosted native runtime ownership, hosted task execution, and graceful stop evidence. If `SKYDEXIA_VERIFY_HOSTED_DATABASE_URL` is not already set, the script will start a temporary Docker Postgres container for the smoke and tear it down afterward.

To inspect the currently resolved package storage mode and roots from the same folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run inspect:storage
```

If you want the package state and runtime evidence to live on a mounted durable volume in self-hosted mode, set `SKYDEXIA_DATA_DIR` to an absolute host path before starting the package server. SkyDexia 2.6 will store workspace state, integration state, deferred/completed release history, runtime recovery state, and persisted runtime logs under that root instead of the default package-local `.runtime-data` directory.

If you want the packaged workspace, integration, SkyeDrive, notification, and release state to be durable in hosted mode too, set `SKYDEXIA_DATABASE_URL` to a Postgres connection string. When that env var is present, the packaged function lane persists state into Postgres instead of the ephemeral function filesystem. Optional envs: `SKYDEXIA_DATABASE_TABLE` to override the table name and `SKYDEXIA_DATABASE_SSL=require` when the hosted provider requires TLS.

Hosted deployments now own runtime materialization, launch, probe, logs, restart, stop, task execution, and task logs natively by default. If you want to attach the hosted lane to an external control plane instead, set `SKYDEXIA_RUNTIME_CONTROL_URL` to a reachable SkyDexia package server or equivalent runtime control endpoint. Hosted `/api/runtime/*` routes will then bridge through that control plane and report `runtime_lane.mode=hosted-runtime-bridge`; otherwise they report `runtime_lane.mode=hosted-native-runtime`.

SkyDexia 2.6 also now ships an integrated workbench layer with reusable task execution, terminal transcripts, task presets, runtime presets, bootstrap templates, port inventory, environment-key inventory, and saved `.skydexia/workbench.json` profiles that make imported projects reproducible instead of purely manual.

The packaged integrations status route and release queue panel now surface the active `storage_backend`, so operators can verify whether the lane is currently running in `file`, `postgres`, or browser-local fallback mode.

Shell modularity verification from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:shell-partials
```

This serve-time verifier starts the package server, fetches the main shell, fetches every shipped shell partial, and asserts that the modularized operator surface is actually being served with the expected slot and control markers.

Crash recovery verification from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:crash-recovery
```

This verifier starts a real runtime, kills the package server abruptly, boots the package server again against the same state root, asserts that the previously running runtime is reconciled into an `interrupted` stop outcome, and then relaunches the saved runtime config without re-entering the command.

Secrets lifecycle verification from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:secrets-lifecycle
```

This verifier exercises provider secret rotation, revocation, environment fallback after revoke, and last-used audit metadata for both GitHub and Netlify against isolated package state.

Structured audit log verification from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:audit-logs
```

This verifier exercises one runtime mutation, one Git mutation, and one explicit autonomy audit event against the live package server, then asserts that `/api/audit/list` returns durable workspace-scoped records for all three domains.

Role access verification from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:role-access
```

This verifier issues deterministic `owner`, `operator`, and `viewer` sessions, then proves that runtime and Git mutations are blocked for viewers, allowed for operators, release execution is allowed for operators, and release connector/secret administration remains owner-only.

## Git operator lane

SkyDexia 2.6 now ships a package-owned Git operator lane for day-to-day repository work inside the product surface.

Primary Git verification gate from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npm run verify:git-phase1:ci
```

This gate runs the conflict, push, remotes/stash, history-ops, branching/tags, and aggregate Phase 1 verifiers in deterministic order.

The Git route contract, endpoint table, safety rules, and recovery runbooks live in `docs/SKYDEXIA-2.6-GIT-OPERATOR-GUIDE.md`.

Operator safety notes:

- use `Pull` with `ff-only` by default; switch to `rebase` or `merge` only when that history shape is intentional
- use `force-with-lease` instead of raw force when a push must rewrite history
- use clean preview before clean execution every time
- treat protected tags as release evidence and only override their guards deliberately
- prefer revert for shared-history rollback and reset for private-history rewrite

Recovery playbooks:

1. Rebase failure: inspect operation-state, resolve conflicts, then continue or abort explicitly.
2. Cherry-pick failure: resolve the conflict queue, continue only after the index is clean, or abort.
3. Merge/stash conflict: use the conflict queue plus `ours`, `theirs`, or `manual` resolution until `has_conflicts=false`.

Static local serve from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
python3 -m http.server 4192
```

Netlify local serve from this folder:

```bash
cd Sky0s-Platforms/SkyeCDE/SkyDexia-2.6
npx netlify-cli dev
```

## Required live environment

For live agent execution:
- `OMEGA_GATE_URL`
- `KAIXU_APP_TOKEN`

For packaged founder unlock and stable signed server sessions:
- `Founders_GateWay_Key` or `FOUNDERS_GATEWAY_KEY`
- `SKYDEXIA_SESSION_SECRET`

For durable hosted state instead of runtime-file persistence:
- `SKYDEXIA_DATABASE_URL`
- optional `SKYDEXIA_DATABASE_TABLE`
- optional `SKYDEXIA_DATABASE_SSL=require`

Founder unlock now fails closed if `SKYDEXIA_SESSION_SECRET` or `SESSION_SECRET` is missing, and the browser no longer fabricates a local founder-success path when the packaged auth lane is unavailable. SkyDexia 2.6 no longer derives signing material from weak fallback values such as site ids or app labels.

For the local package runtime lane:
- `FOUNDERS_GATEWAY_KEY` or `Founders_GateWay_Key`
- `SKYDEXIA_SESSION_SECRET` or `SESSION_SECRET`

Without those variables, `npm start` will still serve the product shell, but founder-gated runtime ownership and protected packaged routes will fail closed instead of silently degrading into privileged local success.

Founder unlock no longer persists a browser-readable bearer token for same-origin package use. Same-origin package and hosted flows now prefer the signed `HttpOnly` founder-session cookie, while any manual standalone bearer use remains session-scoped instead of persistent browser storage. The raw founder gateway key itself is no longer retained in browser storage after unlock succeeds.

The packaged workspace, preview, AI, mail, and release routes assume that founder unlock or a signed bearer token is present. Without that boundary, the browser lane degrades to standalone local fallback instead of exposing packaged state or privileged provider-backed actions anonymously.

For live mail delivery:
- `RESEND_API_KEY`
- `SKYDEXIA_MAIL_FROM`
  or legacy fallback `SKYDEX_MAIL_FROM`
  or `RESEND_FROM_EMAIL`

For real GitHub push execution:
- `SKYDEXIA_GITHUB_TOKEN`
  or fallback `GITHUB_TOKEN`
  or `GH_TOKEN`

If you do not want to depend on env-only GitHub release credentials, connect a GitHub token through the SkyDexia 2.6 browser lane and the packaged server runtime will seal it before storing provider state.

SkyDexia 2.6 now also exposes a secret lifecycle lane for GitHub and Netlify inside the product surface: operators can rotate vaulted provider tokens, revoke vaulted tokens without deleting repo or site metadata, and inspect secret provenance plus last rotate/use/revoke timestamps through `/api/integrations-status` and the release connector panel.

If no GitHub token is available when a push is requested, SkyDexia 2.6 now records a deferred release entry instead of claiming that a remote push already happened.

Once a GitHub token becomes available again, that deferred entry can be replayed from the Release Queue + History panel or through `/api/release-replay`.

For real Netlify deploy execution:
- `SKYDEXIA_NETLIFY_TOKEN`
  or fallback `NETLIFY_AUTH_TOKEN`
  or `NETLIFY_TOKEN`

If you prefer product-managed release credentials, connect a Netlify token through the browser lane and the packaged server runtime will seal it before saving integration state.

If no Netlify token is available when a deploy is requested, SkyDexia 2.6 now records a deferred release entry instead of claiming that a remote deploy already happened.

Once a Netlify token becomes available again, that deferred entry can be replayed from the same release queue surface or through `/api/release-replay`.

## Product rules

1. SkyDex remains the product authority this lane was rebuilt from.
2. SkyDexia 2.6 owns the visible product identity.
3. The host shell is support infrastructure, not the reason the product is alive.
4. External adapters may fail; the core workspace and release continuity should still remain alive locally.
5. Release actions should always describe or operate on the same saved workspace state the agent edited.
6. A sellable package lane must own runtime/process control from inside the package, not only editing and release adapters.

## Current state

SkyDexia 2.6 is now the real copied product lane, not a placeholder reset shell.

What remains after this package boundary is operational rollout work: validating production credentials, remote service permissions, and promotion proof in the target deployment environment.
