# SkyDexia 2.6 Git Operator Contract

## Scope

This document covers the package-owned Git lane exposed by `server.js`, rendered from `index.html` and `ui/partials/git-workspace.html`, and verified by the `scripts/verify-git-*.js` suite.

The Phase 1 Git lane is intended to cover day-to-day operator flows inside the package surface:

- clone, status, diff, log, fetch, fetch-all, pull, push
- branch checkout, branch create, branch delete, branch tracking, merge-base
- remotes CRUD and URL validation
- conflict inventory and conflict resolution
- stash, reset, rebase, cherry-pick, squash, revert, clean
- tag create, tag list, tag delete
- operation-state inspection for in-progress history actions

## Unified mutation contract

All Git mutation routes participate in the normalized mutation envelope applied by `server.js`.

Success shape:

```json
{
  "ok": true,
  "route": "/api/git/push",
  "ts": "2026-03-21T18:24:20.099Z",
  "operation_id": "git_op_example",
  "duration_ms": 141,
  "data": {
    "workspace_id": "default",
    "remote": "origin",
    "branch": "main"
  }
}
```

Failure shape:

```json
{
  "ok": false,
  "route": "/api/git/push",
  "code": "git.route.500",
  "message": "! [rejected] main -> main (fetch first)",
  "details": {
    "ok": false,
    "code": "git.route.500",
    "error": "! [rejected] main -> main (fetch first)",
    "retryable": true
  },
  "retryable": true,
  "ts": "2026-03-21T18:24:20.099Z",
  "operation_id": "git_op_example",
  "duration_ms": 92
}
```

Idempotency and timeout rules:

- mutation routes accept `x-idempotency-key` or `idempotency_key`
- cached mutation replays return `X-SkyDexia-Idempotency-Replay: 1`
- mutation responses include `operation_id` for operator correlation
- timeout failures return `code=git.route.timeout` and `retryable=true`

## Endpoint contract table

| Route | Method | Required input | Safety contract | Success payload highlights |
| --- | --- | --- | --- | --- |
| `/api/git/push` | `POST` | `ws_id`, optional `remote`, `branch`, `set_upstream`, `force_with_lease` | non-fast-forward and lease failures surface as normalized errors | `remote`, `branch`, `tracking`, `git` |
| `/api/git/pull` | `POST` | `ws_id`, optional `remote`, `branch`, `strategy` | supported strategies are `ff-only`, `rebase`, `merge` | `strategy`, `revision`, `git` |
| `/api/git/fetch` | `POST` | `ws_id`, optional `remote`, `prune` | remote selection explicit, prune opt-in | `remote`, `pruned`, `git` |
| `/api/git/fetch-all` | `POST` | `ws_id`, optional `prune` | per-remote outcome model, does not hide partial failures | `outcomes[]`, `pruned`, `git` |
| `/api/git/conflicts` | `GET` or `POST` | `ws_id` | machine-readable conflict inventory | `conflicts.has_conflicts`, `conflicts.files[]` |
| `/api/git/conflicts/resolve` | `POST` | `ws_id`, `path`, `mode`, optional `content` | `mode` must be `ours`, `theirs`, or `manual` | `path`, `mode`, `revision`, `conflicts` |
| `/api/git/remotes` | `GET`, `POST`, `PATCH`, `DELETE` | `ws_id`; mutation requests also require remote name/url | remote URL validation rejects unsupported transports | `remotes[]`, `git` |
| `/api/git/branch-tracking` | `GET` or `POST` | `ws_id` | read-only state check for upstream mapping | `tracking.branch`, `tracking.upstream` |
| `/api/git/branch-tracking/set` | `POST` | `ws_id`, `branch`, optional `remote` | fetches target upstream before assignment | `tracking` |
| `/api/git/branch-tracking/unset` | `POST` | `ws_id`, `branch` | explicit operator action only | `tracking` |
| `/api/git/checkout` | `POST` | `ws_id`, `branch`, optional `create`, `force` | dirty workspace checkout requires `force=true` | `revision`, `git` |
| `/api/git/branch/create` | `POST` | `ws_id`, `name`, optional `checkout`, `remote`, `set_upstream` | branch name validation and optional upstream setup | `branch`, `tracking`, `git` |
| `/api/git/branch/delete` | `POST` | `ws_id`, `name`, optional `force` | merged-state guard unless forced | `branch`, `git` |
| `/api/git/stash/create` | `POST` | `ws_id`, optional `message`, `include_untracked` | leaves revision evidence in response | `stash`, `revision`, `git` |
| `/api/git/stash/list` | `GET` or `POST` | `ws_id` | read-only | `stashes[]` |
| `/api/git/stash/apply` | `POST` | `ws_id`, `stash` | conflict result surfaced with `stash_preserved` details | `conflicts`, `stash_preserved`, `git` |
| `/api/git/stash/pop` | `POST` | `ws_id`, `stash` | conflict result surfaced without hiding preserved stash state | `conflicts`, `stash_preserved`, `git` |
| `/api/git/stash/drop` | `POST` | `ws_id`, `stash` | destructive drop requires explicit stash ref | `output`, `git` |
| `/api/git/reset` | `POST` | `ws_id`, `mode`, optional `target`, `preview`, `confirm` | destructive execution requires typed confirmation contract | `preview`, `revision`, `git` |
| `/api/git/rebase` | `POST` | `ws_id`, `onto` | state transitions visible through operation-state endpoint | `operations`, `git` |
| `/api/git/rebase/continue` | `POST` | `ws_id` | only valid while rebase is active | `operations`, `git` |
| `/api/git/rebase/abort` | `POST` | `ws_id` | abort returns workspace to pre-rebase state | `operations`, `git` |
| `/api/git/cherry-pick` | `POST` | `ws_id`, `commit` | state transitions visible through operation-state endpoint | `operations`, `git` |
| `/api/git/cherry-pick/continue` | `POST` | `ws_id` | only valid while cherry-pick is active | `operations`, `git` |
| `/api/git/cherry-pick/abort` | `POST` | `ws_id` | abort returns workspace to pre-pick state | `operations`, `git` |
| `/api/git/squash` | `POST` | `ws_id`, `base`, `head`, `message` | explicit range selection and message required | `revision`, `git` |
| `/api/git/revert` | `POST` | `ws_id`, `commit` or commit range, optional `no_commit` | returns conflict and in-progress state | `operations`, `conflicts`, `git` |
| `/api/git/tag/create` | `POST` | `ws_id`, `name`, optional `message` | protected tags require explicit override and annotation | `tag`, `git` |
| `/api/git/tag/list` | `GET` or `POST` | `ws_id`, optional pagination/sort | read-only | `tags[]` |
| `/api/git/tag/delete` | `POST` | `ws_id`, `name`, optional protected-tag override | protected tags require explicit delete confirmation | `tag`, `git` |
| `/api/git/clean` | `POST` | `ws_id`, optional `preview`, `paths`, `allow_all`, `include_ignored`, `confirm` | execute path requires `confirm=CLEAN` plus allowlist or `allow_all=true` | `preview`, `cleaned`, `git` |
| `/api/git/operation-state` | `GET` or `POST` | `ws_id` | read-only state for recovery UX | `operations`, `tracking` |

## Operator quickstart

1. Clone or open a workspace through the package lane.
2. Open the Git workspace panel.
3. Refresh status before any destructive action.
4. Use `Fetch` or `Fetch All` before `Pull` or `Push` when the remote may have moved.
5. Use `Pull` with `ff-only` by default. Choose `rebase` or `merge` only when you intend that history shape.
6. Use `Push upstream behavior=auto` for normal tracked branches and `always set upstream` when creating a new branch remotely.
7. Use `Push safety mode=force-with-lease` instead of raw force when history rewrite is intentional.
8. Use `Operation State` and conflict inventory before attempting rebase/cherry-pick recovery actions.

## Recovery runbooks

### Rebase failed

1. Open the operation-state banner and confirm `rebase_in_progress=true`.
2. Open the conflict queue.
3. Resolve files with `ours`, `theirs`, or `manual`.
4. Run `Rebase Continue` when all unmerged entries are gone.
5. Run `Rebase Abort` if the working tree is not salvageable.

### Cherry-pick failed

1. Open the operation-state banner and confirm `cherry_pick_in_progress=true`.
2. Inspect conflict inventory and resolve conflicted files.
3. Use `Cherry-pick Continue` only after the index is clean.
4. Use `Cherry-pick Abort` to restore pre-pick state.

### Conflict after merge, stash apply, or stash pop

1. Open `Conflicts` and refresh the file list.
2. Review stage metadata to confirm which sides are present.
3. Use `ours` or `theirs` for mechanical resolution, or `manual` with final merged content.
4. Re-run conflict inventory until `has_conflicts=false`.

### Reset, revert, clean, and tag safety notes

1. Prefer `reset --soft` or `reset --mixed` before `reset --hard`.
2. Use clean preview before execution every time.
3. Never run clean execution without either an explicit path allowlist or `allow_all=true` plus `confirm=CLEAN`.
4. Treat revert as the safe public-history undo path and reset as the private-history rewrite path.
5. Protected tags require explicit overrides because tag history may be part of release evidence.

## Threat model and audit expectations

The Git lane intentionally treats destructive actions as auditable operator actions.

- destructive routes must surface `operation_id`, `ts`, and `duration_ms`
- retries should use idempotency keys so operators can distinguish replay from duplicate mutation
- remote URLs are validated before remotes are created or updated
- clean and tag deletion have typed or explicit override requirements
- force rewrite flows should prefer `--force-with-lease` to reduce accidental overwrite of unseen remote work
- timeout failures must remain explicit and retryable instead of silently truncating a mutation

When a verifier fails, operators should inspect the route named in the verifier output, then use the operation-state banner, error payload, and route contract in this document to narrow the defect.