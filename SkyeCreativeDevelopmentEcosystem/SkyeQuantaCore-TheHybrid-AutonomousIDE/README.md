# SkyeQuantaCore-TheHybrid-AutonomousIDE

This directory is the self-contained platform base for Skyes Over London's autonomous IDE stack.

It is intentionally built from imported, locally available source so the platform can be evolved here and run from this root without depending on `/workspaces/SkyeHands/SkyeVendors` at runtime.

## Identity

- Company: Skyes Over London
- Product: SkyeQuantaCore-TheHybrid-AutonomousIDE
- AI Identity: kAIxU

## Current Layout

- `platform/agent-core`: imported agent and sandbox stack used as the starting point for the autonomous execution layer
- `platform/ide-core`: imported IDE and remote workspace stack used as the starting point for the browser IDE layer
- `apps/skyequanta-shell`: product-owned composition layer that now owns launch, bootstrap, and workspace-level wiring
- `branding`: product identity and naming overrides
- `docs`: migration notes and vendor-detachment plan
- `scripts`: wrapper and audit scripts for the new platform root

## Important Constraint

This folder is now self-contained from a source-tree perspective. The next phase is cleanup and replacement of upstream naming, startup paths, and integration seams so the vendor folder can be removed without losing build or runtime capability.

## Working Rules

- Build from the imported code already present here, not from a fresh scaffold.
- Keep new product-owned logic at the root or under `apps/`, not buried inside imported upstream trees unless the change is directly upstream-derived.
- Treat `platform/agent-core` and `platform/ide-core` as temporary internal component names, not product branding.

## Autonomous Entry Points

- `npm run setup:system`
- `npm run setup:poetry`
- `npm run bootstrap`
- `npm run doctor`
- `npm run start`
- `npm run dev`
- `npm run bridge:start`
- `npm run smoke:start`
- `make bootstrap`
- `make setup-system`
- `make setup-poetry`
- `make doctor`
- `make start`

## Internal Core Entry Points

- `npm run ide:start`
- `npm run ide:build`
- `npm run ide:bundle`
- `npm run ide:bundle:frontend`
- `npm run ide:bundle:backend`
- `npm run ide:prepare`
- `npm run ide:repair`
- `npm run ide:verify`
- `npm run agent:backend`
- `npm run agent:deps`
- `npm run doctor:branding`

## Bootstrap Requirements

- The IDE side now requires native build support for `node-pty`, `drivelist`, `nsfw`, `native-keymap`, and `keytar`.
- On Ubuntu-based environments, install `libxkbfile-dev` before or during first bootstrap so `native-keymap` can rebuild successfully.
- On Ubuntu-based environments, install `libsecret-1-dev` before or during first bootstrap so `keytar` can rebuild successfully.
- `npm run bootstrap` now installs IDE dependencies, compiles the internal browser workspace, rebuilds the native modules, and generates the browser example artifacts needed by `npm run start`.
- `npm run bootstrap` also verifies the bundled ripgrep payload under `platform/ide-core/node_modules/@vscode/ripgrep/bin/` so browser-app rebuilds do not depend on a half-finished upstream postinstall.
- `npm run ide:prepare` exposes that IDE prebuild pipeline directly through the product shell, without depending on the imported monorepo build entrypoint.
- `npm run ide:bundle:frontend` and `npm run ide:bundle:backend` split the imported webpack phase into smaller product-owned targets for diagnosis and recovery.
- `npm run ide:verify` checks for the expected browser/backend bundle artifacts without forcing a rebuild.
- `npm run doctor` now verifies the expected IDE bundle artifacts as part of the product-owned readiness contract.
- `npm run bootstrap` also installs Poetry if it is missing, syncs the canonical agent config into `platform/agent-core/config.toml`, creates a generated runtime secret file under `.skyequanta/runtime.env`, and prepares the root `workspace/` directory.

## Product-Owned Runtime State

- `config/agent/config.toml` is the canonical agent configuration source for this product root.
- `.skyequanta/runtime.env` is generated automatically and stores local runtime-only values such as `OH_SECRET_KEY`.
- `.skyequanta/ide-config` is the product-owned IDE config root used by the shell instead of the user home directory.
- `platform/ide-core/plugins` is created locally so the IDE no longer depends on missing default plugin directories.
- `.env` and `.env.local` are supported for product overrides without editing imported component trees.

## Bridge Layer

- `npm run start` now includes a shell-owned bridge service at `http://127.0.0.1:3020` by default.
- The browser-facing IDE surface is now the bridge root, so the browser only needs the product-owned URL instead of a direct internal IDE port.
- `GET /api/status` returns product-level readiness information for the IDE and agent backend.
- `GET /api/runtime-contract` returns the shell-owned browser/runtime contract for the current product surface.
- `GET /api/agent/*` proxies HTTP requests to the internal agent backend so the shell owns the first shared runtime integration layer.
- `GET /api/workspaces*` and `POST /api/workspaces*` expose shell-owned workspace control operations (list/create/select/start/stop/status/ports).
- `GET /w/:workspaceId/p/:port/*` proxies HTTP and websocket traffic to workspace-approved forwarded local ports.
- Gate configuration is part of the runtime contract and is required by default.
- `npm run doctor` fails when `SKYEQUANTA_GATE_URL` / `OMEGA_GATE_URL` or `SKYEQUANTA_GATE_TOKEN` / `SKYEQUANTA_OSKEY` are missing.

### Auth And Session Boundaries

- Workspace control APIs are now protected by admin/session boundaries.
- Admin operations require a bearer token set by `SKYEQUANTA_ADMIN_TOKEN` (falls back to `OH_SECRET_KEY` if unset).
- Tenant ownership is enforced per workspace using `metadata.tenantId` and request/session tenant context.
- Workspace-prefixed runtime routes (`/w/:workspaceId/*`) require a valid workspace-bound session token.

### Persistent Session Orchestration

- Sessions are persisted in `.skyequanta/sessions.json` and survive bridge restarts.
- Open a workspace session from gate auth: `POST /api/sessions/open` with `{ workspaceId, clientName, token? }` or a bearer gate session token.
- Founder gateway credentials are accepted through the same gate contract and count as administrative authority.
- Local workspace session tokens are derived from a validated gate identity; the gate remains the source of truth.
- Reconnect with token rotation: `POST /api/sessions/reconnect` with `{ sessionId, reconnectToken }`.
- Keep alive and extend expiry: `POST /api/sessions/:sessionId/heartbeat` with bearer access token.
- Close session: `POST /api/sessions/:sessionId/close`.
- List sessions (admin or founder gateway): `GET /api/sessions?tenantId=<tenant>`.

### Resource Governance And Audit Trail

- Governance policy is persisted at `.skyequanta/governance-policy.json`.
- Audit trail is persisted at `.skyequanta/audit-log.json`.
- Enforced limits include max workspaces, max concurrent sessions, max forwarded ports per workspace, max snapshots per workspace, max snapshot size, and max retained audit events.
- Configure limits through env vars:
	- `SKYEQUANTA_LIMIT_MAX_WORKSPACES`
	- `SKYEQUANTA_LIMIT_MAX_SESSIONS`
	- `SKYEQUANTA_LIMIT_MAX_FORWARDED_PORTS`
	- `SKYEQUANTA_LIMIT_MAX_SNAPSHOTS`
	- `SKYEQUANTA_LIMIT_MAX_SNAPSHOT_BYTES`
	- `SKYEQUANTA_LIMIT_MAX_AUDIT_EVENTS`
- Read policy (admin): `GET /api/governance/policy`.
- Read usage (admin): `GET /api/governance/usage`.
- Read audit trail (admin): `GET /api/audit?limit=100&offset=0&workspaceId=<id>&tenantId=<tenant>&startAt=<iso>&endAt=<iso>`.
- Audit results now include pagination metadata (`total`, `offset`, `limit`, `hasMore`, `nextOffset`) for large installations.

### Workspace Scheduler And Health Remediation

- Scheduler policy is persisted at `.skyequanta/workspace-scheduler-policy.json`.
- Scheduler runtime state is persisted at `.skyequanta/workspace-scheduler-state.json`.
- Bridge starts the scheduler controller automatically; periodic sweeps only run when policy `enabled` is true.
- Each sweep checks runtime process state and health endpoints for running workspaces.
- Unhealthy running workspaces are automatically remediated with stop/start restart, bounded by policy limits (`maxRestartsPerRun`, `restartCooldownMs`).
- Scheduler can also run autonomous maintenance tasks: expired session cleanup and periodic snapshot retention cleanup.
- Configure scheduler policy through env vars:
	- `SKYEQUANTA_SCHEDULER_ENABLED`
	- `SKYEQUANTA_SCHEDULER_INTERVAL_MS`
	- `SKYEQUANTA_SCHEDULER_HEALTH_TIMEOUT_MS`
	- `SKYEQUANTA_SCHEDULER_MAX_RESTARTS_PER_RUN`
	- `SKYEQUANTA_SCHEDULER_RESTART_COOLDOWN_MS`
	- `SKYEQUANTA_SCHEDULER_CLEANUP_EXPIRED_SESSIONS`
	- `SKYEQUANTA_SCHEDULER_RETENTION_CLEANUP_ENABLED`
	- `SKYEQUANTA_SCHEDULER_RETENTION_CLEANUP_EVERY_RUNS`
	- `SKYEQUANTA_SCHEDULER_HISTORY_MAX_ENTRIES`
- Bridge APIs (admin):
	- `GET /api/scheduler`
	- `GET /api/scheduler/history?limit=100&offset=0&trigger=<name>&startAt=<iso>&endAt=<iso>`
	- `GET /api/scheduler/trends?bucket=day&limit=120&offset=0&trigger=<name>&startAt=<iso>&endAt=<iso>`
	- `GET /api/scheduler/trends/compact?bucket=day&trigger=<name>&startAt=<iso>&endAt=<iso>`
	- `GET /api/control-plane/summary?bucket=day&trigger=<name>&startAt=<iso>&endAt=<iso>`
	- `POST /api/scheduler/start`
	- `POST /api/scheduler/stop`
	- `POST /api/scheduler/policy` with `{ enabled?, intervalMs?, healthTimeoutMs?, maxRestartsPerRun?, restartCooldownMs?, cleanupExpiredSessions?, retentionCleanupEnabled?, retentionCleanupEveryRuns?, historyMaxEntries? }`
	- `POST /api/scheduler/run` with `{ workspaceId? }`
- Scheduler history API returns per-run trend points with `summary`, `delta`, and cumulative `totals`, suitable for control plane graphing.
- Scheduler trends API returns pre-aggregated bucketed metrics (`minute|hour|day|week`) for direct dashboard charts.
- Scheduler compact trends API returns only `cumulativeTotals` plus `latestBucket` for lightweight status cards.
- Control plane summary API returns scheduler card data plus workspace/session/governance high-level metrics in one lightweight payload.
- CLI:
	- `npm run workspace -- scheduler`
	- `npm run workspace -- scheduler:card --bucket day [--trigger <name>] [--start-at <iso>] [--end-at <iso>]`
	- `npm run workspace -- scheduler:policy:set --enabled --interval-ms 60000 --health-timeout-ms 3000 --max-restarts-per-run 3 --restart-cooldown-ms 300000 --cleanup-expired-sessions --retention-cleanup-enabled --retention-cleanup-every-runs 5`
	- `npm run workspace -- scheduler:run [workspaceId]`

### Workspace Snapshot And Restore

- Snapshot index is persisted at `.skyequanta/workspace-snapshots.json`.
- Snapshot payloads are stored under `.skyequanta/snapshots/<workspaceId>/<snapshotId>/`.
- Create snapshot (workspace auth/session boundary applies): `POST /api/workspaces/:workspaceId/snapshots` with `{ label?, restartAfter? }`.
- List snapshots: `GET /api/workspaces/:workspaceId/snapshots`.
- Describe one snapshot: `GET /api/workspaces/:workspaceId/snapshots/:snapshotId`.
- Restore snapshot: `POST /api/workspaces/:workspaceId/snapshots/:snapshotId/restore` with `{ restartAfter? }`.
- Delete snapshot: `DELETE /api/workspaces/:workspaceId/snapshots/:snapshotId`.
- Delete workspace (admin): `DELETE /api/workspaces/:workspaceId`.
- CLI:
	- `npm run workspace -- snapshots <workspaceId>`
	- `npm run workspace -- delete <workspaceId>`
	- `npm run workspace -- snapshot:create <workspaceId> --label "pre-upgrade"`
	- `npm run workspace -- snapshot:describe <workspaceId> --snapshot <snapshotId>`
	- `npm run workspace -- snapshot:restore <workspaceId> --snapshot <snapshotId>`
	- `npm run workspace -- snapshot:delete <workspaceId> --snapshot <snapshotId>`

### Snapshot Retention Policies

- Retention policy is persisted at `.skyequanta/snapshot-retention.json`.
- Retention supports defaults, tenant-level overrides, and workspace-level overrides.
- Automatic cleanup runs after snapshot creation and removes snapshots exceeding `maxSnapshots` or `maxAgeDays` for the effective policy.
- Bridge policy APIs (admin):
	- `GET /api/snapshots/retention?workspaceId=<id>`
	- `POST /api/snapshots/retention` with `{ scope: defaults|tenant|workspace, mode: set|clear, tenantId?, workspaceId?, maxSnapshots?, maxAgeDays? }`
	- `POST /api/snapshots/retention/cleanup` with `{ workspaceId?, protectSnapshotId? }`
- Workspace-scoped retention APIs:
	- `GET /api/workspaces/:workspaceId/snapshot-retention`
	- `POST /api/workspaces/:workspaceId/snapshot-retention`
	- `POST /api/workspaces/:workspaceId/snapshot-retention-cleanup`
- CLI:
	- `npm run workspace -- snapshot-retention [workspaceId]`
	- `npm run workspace -- snapshot-retention:set [workspaceId] --scope workspace --max-snapshots 10 --max-age-days 14`
	- `npm run workspace -- snapshot-retention:set --tenant local --scope tenant --max-snapshots 25 --max-age-days 30`
	- `npm run workspace -- snapshot-retention:cleanup [workspaceId]`

### Forwarded Port Policy

- Forwarded ports are denied by default per workspace.
- Allow one port: `npm run workspace -- ports:allow <workspaceId> --ports <port>`.
- Deny one port: `npm run workspace -- ports:deny <workspaceId> --ports <port>`.
- Replace the full allowlist: `npm run workspace -- ports:set <workspaceId> --ports 3000,5173`.
- Read current policy: `npm run workspace -- ports <workspaceId>`.

### Real Workspace Provisioning

- `workspace start <workspaceId>` now performs real provisioning, not just status metadata updates.
- Each workspace is assigned an isolated runtime root at `workspace/instances/<workspaceId>/` with a dedicated filesystem subtree under `fs/`.
- The shell provisions dedicated per-workspace runtime processes (isolated IDE and agent services) with independent ports and persisted runtime state.
- Runtime state is stored under `.skyequanta/workspace-runtime/<workspaceId>/state.json` and includes ports, process IDs, root paths, and logs.
- Bridge routing for `/w/:workspaceId/*` resolves to the workspace runtime endpoints when running.
- Inspect runtime state using:
	- CLI: `npm run workspace -- runtime <workspaceId>`
	- API: `GET /api/workspaces/:workspaceId/runtime`

## First-Run Flow

1. Run `npm run bootstrap`.
2. Run `npm run doctor`.
3. Run `npm run start` for product mode, or `npm run dev` for reload-enabled development mode.
4. Run `npm run smoke:start` if you want a root-level HTTP verification of both product services.

## Immediate Next Steps

1. Replace visible upstream branding in startup surfaces that users still see inside imported cores.
2. Move more frontend/runtime wiring onto the shell-owned runtime contract so imported cores depend on product-owned integration surfaces.
3. Keep the product surface on the V1 backend path and avoid re-exposing deprecated OpenHands V0 flows.
4. Move more environment and deployment policy into the shell so imported cores become internal implementation details.
5. Trim unused imported code after the first successful self-hosted build.