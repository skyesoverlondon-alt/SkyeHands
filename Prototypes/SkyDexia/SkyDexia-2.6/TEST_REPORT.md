# SkyDexia 2.6 Test Report

## Verified
- `index.html` serves as a standalone product entrypoint from the SkyDexia 2.6 folder.
- Local `_shared/auth-unlock.js` and `_shared/standalone-session.js` are present and no longer depend on repo-root absolute paths.
- Browser-state namespaces are isolated to `skydexia26.*` keys instead of original SkyDex keys.
- `netlify/functions/ai-agent.js` identifies as SkyDexia 2.6 and stays gate-wired through `OMEGA_GATE_URL` plus `KAIXU_APP_TOKEN`.
- `netlify/functions/skymail-send.js` supports `SKYDEXIA_MAIL_FROM` with legacy fallback support.
- `server.js` now serves the package, proxies packaged function routes, and exposes authenticated `/api/runtime/*` runtime ownership routes.
- `server.js` now persists package-local workspace materialization metadata and last runtime launch config so recovery survives a package-server restart.
- `server.js` now persists the last runtime log stream per workspace and waits for the final stopped-state write during graceful shutdown so restart recovery stays truthful.
- `package.json` now gives SkyDexia 2.6 a package-owned `npm start` / `npm run dev` startup contract.
- `package.json` now also exposes `npm run verify`, a package-owned smoke that re-proves founder auth, runtime ownership, and deferred release truth from the self-hosted package lane.
- Packaged Netlify server lane now includes founder auth, workspace persistence, integrations status, SkyeDrive source list/open/push, SKNore preview, app record list, GitHub connect/push, Netlify connect/deploy, and SkyeChat queue endpoints.
- GitHub and Netlify connect routes now seal provided provider tokens before they are written into packaged runtime state.
- GitHub connect now validates repo access when a release token is supplied, mirroring the existing Netlify site validation path.
- Read-side workspace, integration, SkyeDrive, and record endpoints now require founder/session auth instead of exposing packaged state anonymously.
- AI agent, mail delivery, and SKNore preview endpoints now require founder/session auth before they can consume packaged provider credentials or evaluate server-side workspace policy.
- `github-push.js` now performs a real GitHub Trees API publish flow when a GitHub token is configured.
- `netlify-deploy.js` now performs a real ZIP-based Netlify deploy when a Netlify token is configured.
- Obsolete reset-shell `src/app.css` and `src/app.js` were removed so the package surface matches the actual shipped runtime.
- Sovereign registry notes now describe SkyDexia 2.6 instead of the old SkyDex 4.6 label.

## Standalone boot proof
- Static serve check returned `HTTP/1.0 200 OK` for `index.html`.
- Static serve check returned `HTTP/1.0 200 OK` for `_shared/standalone-session.js`.
- Served HTML title is `SkyDexia 2.6`.
- The packaged Netlify function set now covers the browser's founder unlock, workspace save/load, SkyeDrive, release preview, and real release execution routes.

## Packaged API smoke proof
- Founder unlock returned `200` and issued a signed session token through `auth-founder-gateway.js`.
- `ws-save.js` persisted a demo workspace and `ws-get.js` returned the saved file set.
- `sknore-release-preview.js` blocked one `.env` path in a controlled test payload.
- `skyedrive-push.js` created a restore record and `skyedrive-source-open.js` reopened it successfully.
- `integrations-status.js`, `github-app-connect.js`, `netlify-connect.js`, and `skychat-notify.js` all returned successful packaged responses in a local Node integration run.
- A mocked upstream integration run verified founder auth, workspace save, GitHub push branch creation, Netlify deploy ZIP upload, and secret-safe integration status responses end to end.
- A credential smoke run verified that connected GitHub and Netlify tokens are sealed at rest, not stored plaintext in `.runtime-data`, and are still usable for real release execution.
- A secured-read smoke run verified `401` responses for unauthenticated workspace and integration reads, while founder-authenticated reads still returned workspace files, SkyeDrive records, and sanitized provider readiness.
- A secured-provider smoke run verified `401` responses for unauthenticated AI, mail, and SKNore preview requests, while founder-authenticated requests still returned successful stubbed provider responses and SKNore evaluation output.
- Browser fallback now activates only when the packaged server lane is unavailable; live `401` and other server-side failures are surfaced directly instead of being downgraded into fake local release success.
- Founder unlock and token verification now require an explicitly configured `SKYDEXIA_SESSION_SECRET` or `SESSION_SECRET`; the packaged runtime no longer signs or verifies sessions with predictable fallback secrets.
- Founder unlock browser fallback no longer fabricates a synthetic owner session when `/api/auth-founder-gateway` is unavailable or returns an error.
- Missing GitHub and Netlify release credentials now return deferred release records instead of fake pushed commit or deploy ids, and `integrations-status.js` exposes those queued entries back to the product UI.
- Deferred GitHub and Netlify release entries are now replayable through `/api/release-replay`, and the UI exposes replay controls directly inside the release queue panel.
- Privileged package functions no longer advertise wildcard CORS by default; origin exposure is now scoped to an explicit deployment origin env when one is configured.
- Standalone browser bearer tokens are now migrated out of persistent local storage and kept in session-scoped storage for the current browser session.
- The browser no longer retains the raw founder gateway key in session or local storage after founder unlock succeeds, founder unlock no longer persists a same-origin bearer token for routine package use, and hosted founder-session cookies now automatically add `Secure` when the request origin is HTTPS.
- Package state and local runtime evidence can now be redirected to a durable mounted root with `SKYDEXIA_DATA_DIR` instead of staying pinned to the default package-local `.runtime-data` path.
- The packaged function lane now supports durable Postgres-backed state with `SKYDEXIA_DATABASE_URL`, replacing ephemeral hosted runtime-file persistence for workspace, integration, SkyeDrive, notification, and release data when configured.
- `integrations-status.js` now reports the active `storage_backend`, and the release queue panel reflects that backend so operators can see whether the lane is currently running on package files, Postgres, or browser-local fallback state.
- Hosted runtime routes now exist under `netlify/functions/runtime/*` and can bridge hosted runtime control into a real package server when `SKYDEXIA_RUNTIME_CONTROL_URL` is configured.

## Local package runtime smoke proof
- `npm start` booted the new `server.js` package server locally.
- Founder unlock against the local package server returned `200` and issued a signed cookie/token pair.
- `ws-save` persisted a runnable demo workspace through the same local package server session.
- `/api/runtime/materialize` wrote the saved workspace to a confined package runtime directory under `.runtime-data/local-package-server/materialized-workspaces`.
- `/api/runtime/start` launched a real child process from the materialized workspace and returned a runtime id plus launch URL.
- `/api/runtime/logs` returned captured stdout and stderr for the launched process.
- `/api/runtime/probe` returned a successful health probe against the launched runtime URL.
- `/api/runtime/restart` returned a fresh runtime record after stopping and relaunching the process.
- `/api/runtime/stop` cleanly stopped the runtime and reported the stopped state back through the package API.
- Verified status sequence: founder unlock `200`, workspace save `200`, materialize `200`, runtime start `200`, logs `200`, probe `200` with `ok=true`, restart `200`, and stop `200` with final runtime status `stopped`.
- A fresh rerun after the strict `/api/runtime/*` non-fallback hardening again returned founder auth `200`, workspace save `200`, materialize `200`, runtime start `200`, logs `200`, probe `200` with `ok=true` and HTTP `200`, restart `200`, and stop `200` with final runtime status `stopped`.
- Recovery continuity proof now passes across a package-server restart: after a runtime was started, the package server was terminated and restarted, `/api/runtime/list` returned persisted `workspace_runtime` metadata, the saved launch config remained `python3 -m http.server 4312 --bind 127.0.0.1`, and the last runtime snapshot came back as `stopped` instead of disappearing.
- Recovery relaunch also passed with no new runtime config supplied: post-restart `/api/runtime/start` returned `200`, reused the persisted launch URL `http://127.0.0.1:4312/`, `/api/runtime/probe` returned `200` with `ok=true`, and `/api/runtime/stop` returned `200` with final runtime status `stopped`.
- Latest recorded recovery proof: materialized path `/workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/SkyeCDE/SkyDexia-2.6/netlify/functions/.runtime-data/local-package-server/materialized-workspaces/default`, initial runtime id `runtime_mmxwpuyo_un2lw9i3`, persisted stopped-at `2026-03-19T20:12:39.639Z`, recovered runtime id `runtime_mmxws58s_pmc5ont3`, and shared launch URL `http://127.0.0.1:4312/`.
- Graceful restart log continuity now also passes: a runtime emitted known stdout and stderr markers, the package server received `SIGTERM`, `/api/runtime/list?ws_id=default` came back `200` after restart with last runtime status `stopped` and stopped-at `2026-03-19T20:30:04.429Z`, and `/api/runtime/logs?ws_id=default` returned `200` with both persisted markers plus `last_runtime_logs` metadata `{ "runtime_id": "runtime_mmxxc5hv_6o6p1ft2", "stdout_size": 22, "stderr_size": 22, "updated_at": "2026-03-19T20:29:59.661Z" }`.
- Crash recovery proof now also passes: after a runtime was started and the package server was terminated with `SIGKILL`, the next package boot reconciled the last runtime snapshot to `status=stopped` with `stop_outcome.result=interrupted` and `reason=startup-reconciliation`, preserved the recoverable runtime config, and relaunched the same saved command without re-entering it.
- Shell modularity serve proof now also passes: the package server returned `200` for the main shell plus every shipped shell partial, and each partial served the expected operator markers for overlays, shell chrome, workspace frame, control-rail intro, and the nested lane surfaces.
- Secrets lifecycle proof now also passes: GitHub and Netlify both support vaulted token rotation, explicit revoke, truthful environment fallback after revoke, and `integrations-status` now reports `secret_inventory` metadata including source, rotation count, last rotate timestamp, last revoke timestamp, and last used timestamp.
- Structured audit log proof now also passes: one runtime materialize mutation, one Git clone mutation, and one explicit autonomy apply audit event were written through the live package server, and `/api/audit/list` returned durable workspace-scoped records for `runtime`, `git`, and `autonomy` with truthful route metadata.
- Role access proof now also passes: deterministic `viewer`, `operator`, and `owner` sessions showed `viewer` runtime mutation `403`, `operator` runtime mutation `200`, `viewer` Git mutation `403`, `operator` Git mutation `200`, `operator` release execution allowed past permission checks, `operator` release connector admin `403`, and owner-only release-admin routes falling through to normal validation instead of permission denial.
- A handler-level deferred release smoke with temporary local founder/session env returned founder auth `200`, GitHub push `202` with `deferred=true`, Netlify deploy `202` with `deferred=true`, and `integrations-status` reported two deferred queue entries (`Netlify:deferred`, `GitHub:deferred`) with zero completed history items.
- `npm run verify` now replays a package-owned smoke that checks founder auth `200`, runtime start/probe/stop, GitHub push `202 deferred`, Netlify deploy `202 deferred`, a deferred release queue count of `2`, and a truthful `/api/release-replay` response for an isolated verify workspace.
- `npm run verify` now also asserts the default self-hosted storage backend is `file`, and `npm run inspect:storage` prints the resolved storage backend, data root, and storage table contract.
- Runtime launches can now carry an optional stop recipe, and stop responses/log surfaces now distinguish graceful and forced outcomes instead of reporting only a generic stop.
- `npm run verify:hosted` now proves hosted `storage_backend=postgres`, cold-start durability for workspace/integration/deferred release and release-history state, hosted native runtime launch/probe/stop through `runtime_lane.mode=hosted-native-runtime`, hosted task execution through `/api/runtime/task-start` plus `/api/runtime/task-logs`, and a graceful stop outcome.
- The workbench layer now exposes reusable runtime presets, terminal and task execution, port inventory, environment-key inventory, and bootstrap templates that save a reproducible `.skydexia/workbench.json` profile into the workspace.

## Phase 1 git verification matrix
- Verification timestamp: `2026-03-21T18:24:20Z`
- `node scripts/verify-git-conflicts.js` passed and proved deterministic conflict inventory plus `ours`, `theirs`, and `manual` resolution.
- `node scripts/verify-git-push.js` passed and proved push success, idempotent replay, non-fast-forward rejection, and stale `force-with-lease` rejection.
- `node scripts/verify-git-remotes-stash.js` passed and proved remotes CRUD, remote URL policy rejection, stash lifecycle, and stash conflict behavior.
- `node scripts/verify-git-history-ops.js` passed and proved reset safety, rebase/cherry-pick/squash/revert flows, clean preview/execute safety, and in-progress operation-state reporting.
- `node scripts/verify-git-branching-tags.js` passed and proved branch lifecycle, branch tracking, merge-base, and protected-tag guardrails.
- `node scripts/verify-git-phase1.js` passed and emitted a summary JSON artifact covering verifier order plus contract checks for `operation_id`, `duration_ms`, idempotent replay, timeout contract, retryable failure contract, and normalized success route metadata.

## Git verifier triage map
- `verify-git-conflicts`: inspect `/api/git/conflicts`, `/api/git/conflicts/resolve`, conflict inventory parsing, or UI/manual resolution wiring.
- `verify-git-push`: inspect `/api/git/push`, push option wiring in `index.html`, idempotency replay handling, or remote divergence handling.
- `verify-git-remotes-stash`: inspect `/api/git/remotes`, remote URL validation, stash apply/pop handling, or stash conflict reporting.
- `verify-git-history-ops`: inspect `/api/git/reset`, `/api/git/rebase*`, `/api/git/cherry-pick*`, `/api/git/squash`, `/api/git/revert`, `/api/git/clean`, or `/api/git/operation-state`.
- `verify-git-branching-tags`: inspect `/api/git/branch-*`, `/api/git/branch-tracking*`, `/api/git/merge-base`, `/api/git/tag-*`, or related UI controls.
- `verify-git-phase1`: inspect the failing sub-verifier first; if all sub-verifiers pass, inspect the normalized Git mutation envelope in `server.js`.

## Remaining live dependency
- Real agent execution still requires deployed server env for `OMEGA_GATE_URL` and `KAIXU_APP_TOKEN`.
- Real mail delivery still requires `RESEND_API_KEY` plus `SKYDEXIA_MAIL_FROM` or one of its documented fallbacks.
- Founder unlock requires `Founders_GateWay_Key` or `FOUNDERS_GATEWAY_KEY` plus a stable `SKYDEXIA_SESSION_SECRET`.
- Real GitHub push still requires a valid GitHub token with repo write access.
- Real Netlify deploy still requires a valid Netlify token with access to the target site.
