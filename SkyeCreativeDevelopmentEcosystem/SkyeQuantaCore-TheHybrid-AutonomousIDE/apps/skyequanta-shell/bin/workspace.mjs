import { getStackConfig } from './config.mjs';
import { ensureRuntimeState } from '../lib/runtime.mjs';
import {
  allowWorkspacePort,
  createSnapshot,
  createWorkspace,
  deleteWorkspace,
  describeSnapshot,
  denyWorkspacePort,
  ensureDefaultWorkspace,
  getWorkspace,
  getSnapshotRetention,
  getWorkspaceRuntime,
  listSnapshots,
  listWorkspacePorts,
  listWorkspaces,
  removeSnapshot,
  runSnapshotRetentionCleanup,
  restoreSnapshot,
  setSnapshotRetention,
  selectWorkspace,
  setWorkspacePorts,
  startWorkspace,
  stopWorkspace,
  updateWorkspaceStatus
} from '../lib/workspace-manager.mjs';
import {
  createWorkspaceSchedulerController,
  getWorkspaceSchedulerSnapshot,
  getWorkspaceSchedulerTrendsCompact
} from '../lib/workspace-scheduler.mjs';

function parseArgs(argv) {
  const [command = 'list', ...rest] = argv;
  const options = {
    command,
    id: null,
    name: null,
    status: null,
    reason: null,
    forwardedHost: null,
    ports: [],
    label: null,
    snapshotId: null,
    restartAfter: true,
    tenantId: null,
    scope: null,
    mode: 'set',
    maxSnapshots: null,
    maxAgeDays: null,
    intervalMs: null,
    healthTimeoutMs: null,
    maxRestartsPerRun: null,
    restartCooldownMs: null,
    enabled: null,
    cleanupExpiredSessions: null,
    retentionCleanupEnabled: null,
    retentionCleanupEveryRuns: null,
    historyMaxEntries: null,
    bucket: 'day',
    trigger: null,
    startAt: null,
    endAt: null,
    force: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--name') {
      options.name = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--status') {
      options.status = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--reason') {
      options.reason = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--forwarded-host') {
      options.forwardedHost = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--ports') {
      const raw = String(rest[index + 1] || '').trim();
      options.ports = raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (value === '--label') {
      options.label = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--snapshot') {
      options.snapshotId = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--no-restart') {
      options.restartAfter = false;
      continue;
    }

    if (value === '--tenant') {
      options.tenantId = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--scope') {
      options.scope = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--mode') {
      options.mode = rest[index + 1] || 'set';
      index += 1;
      continue;
    }

    if (value === '--max-snapshots') {
      options.maxSnapshots = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--max-age-days') {
      options.maxAgeDays = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--force') {
      options.force = true;
      continue;
    }

    if (value === '--interval-ms') {
      options.intervalMs = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--health-timeout-ms') {
      options.healthTimeoutMs = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--max-restarts-per-run') {
      options.maxRestartsPerRun = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--restart-cooldown-ms') {
      options.restartCooldownMs = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--enabled') {
      options.enabled = true;
      continue;
    }

    if (value === '--disabled') {
      options.enabled = false;
      continue;
    }

    if (value === '--cleanup-expired-sessions') {
      options.cleanupExpiredSessions = true;
      continue;
    }

    if (value === '--no-cleanup-expired-sessions') {
      options.cleanupExpiredSessions = false;
      continue;
    }

    if (value === '--retention-cleanup-enabled') {
      options.retentionCleanupEnabled = true;
      continue;
    }

    if (value === '--retention-cleanup-disabled') {
      options.retentionCleanupEnabled = false;
      continue;
    }

    if (value === '--retention-cleanup-every-runs') {
      options.retentionCleanupEveryRuns = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--history-max-entries') {
      options.historyMaxEntries = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--bucket') {
      options.bucket = rest[index + 1] || 'day';
      index += 1;
      continue;
    }

    if (value === '--trigger') {
      options.trigger = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--start-at') {
      options.startAt = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--end-at') {
      options.endAt = rest[index + 1] || null;
      index += 1;
      continue;
    }

    if (!options.id) {
      options.id = value;
      continue;
    }

    if (!options.snapshotId) {
      options.snapshotId = value;
    }
  }

  return options;
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const config = getStackConfig();
  ensureRuntimeState(config, process.env);

  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'ensure-default') {
    const { workspace } = ensureDefaultWorkspace(config);
    printJson({ ok: true, action: 'ensure-default', workspace });
    return;
  }

  if (args.command === 'create') {
    if (!args.id) {
      throw new Error('Workspace id is required for create.');
    }
    const result = createWorkspace(config, args.id, { name: args.name || args.id });
    printJson({ ok: true, action: 'create', created: result.created, workspace: result.workspace });
    return;
  }

  if (args.command === 'current') {
    const defaultState = ensureDefaultWorkspace(config);
    printJson({ ok: true, action: 'current', workspace: defaultState.workspace });
    return;
  }

  if (args.command === 'describe') {
    const workspace = getWorkspace(config, args.id);
    if (!workspace) {
      printJson({ ok: false, error: 'workspace_not_found', workspaceId: args.id || null });
      process.exitCode = 1;
      return;
    }

    printJson({ ok: true, action: 'describe', workspace });
    return;
  }

  if (args.command === 'select') {
    if (!args.id) {
      throw new Error('Workspace id is required for select.');
    }
    const result = selectWorkspace(config, args.id);
    printJson({ ok: true, action: 'select', workspace: result.workspace });
    return;
  }

  if (args.command === 'start') {
    if (!args.id) {
      throw new Error('Workspace id is required for start.');
    }
    const result = await startWorkspace(config, args.id, args.reason || 'cli_start');
    printJson({ ok: true, action: 'start', workspace: result.workspace });
    return;
  }

  if (args.command === 'stop') {
    if (!args.id) {
      throw new Error('Workspace id is required for stop.');
    }
    const result = await stopWorkspace(config, args.id, args.reason || 'cli_stop');
    printJson({ ok: true, action: 'stop', workspace: result.workspace });
    return;
  }

  if (args.command === 'delete') {
    if (!args.id) {
      throw new Error('Workspace id is required for delete.');
    }
    const result = await deleteWorkspace(config, args.id, {
      deletedBy: 'workspace-cli',
      force: args.force
    });
    printJson({ ok: true, action: 'delete', ...result });
    return;
  }

  if (args.command === 'runtime') {
    if (!args.id) {
      throw new Error('Workspace id is required for runtime.');
    }
    const result = getWorkspaceRuntime(config, args.id);
    printJson({
      ok: true,
      action: 'runtime',
      workspace: result.workspace,
      runtime: result.runtime,
      state: result.state
    });
    return;
  }

  if (args.command === 'status') {
    if (!args.id) {
      throw new Error('Workspace id is required for status.');
    }
    if (!args.status) {
      throw new Error('Use --status <ready|running|stopped|error> for status updates.');
    }
    const result = updateWorkspaceStatus(config, args.id, args.status, args.reason || 'cli_status_update');
    printJson({ ok: true, action: 'status', workspace: result.workspace });
    return;
  }

  if (args.command === 'ports') {
    if (!args.id) {
      throw new Error('Workspace id is required for ports.');
    }
    const result = listWorkspacePorts(config, args.id);
    printJson({
      ok: true,
      action: 'ports',
      workspace: result.workspace,
      forwardedHost: result.forwardedHost,
      forwardedPorts: result.forwardedPorts
    });
    return;
  }

  if (args.command === 'ports:set') {
    if (!args.id) {
      throw new Error('Workspace id is required for ports:set.');
    }
    const result = setWorkspacePorts(config, args.id, args.ports, {
      forwardedHost: args.forwardedHost
    });
    printJson({ ok: true, action: 'ports:set', workspace: result.workspace });
    return;
  }

  if (args.command === 'ports:allow') {
    if (!args.id) {
      throw new Error('Workspace id is required for ports:allow.');
    }
    if (!args.ports.length) {
      throw new Error('Use --ports <port> for ports:allow.');
    }
    const result = allowWorkspacePort(config, args.id, args.ports[0], {
      forwardedHost: args.forwardedHost
    });
    printJson({ ok: true, action: 'ports:allow', workspace: result.workspace });
    return;
  }

  if (args.command === 'ports:deny') {
    if (!args.id) {
      throw new Error('Workspace id is required for ports:deny.');
    }
    if (!args.ports.length) {
      throw new Error('Use --ports <port> for ports:deny.');
    }
    const result = denyWorkspacePort(config, args.id, args.ports[0]);
    printJson({ ok: true, action: 'ports:deny', workspace: result.workspace });
    return;
  }

  if (args.command === 'snapshots') {
    if (!args.id) {
      throw new Error('Workspace id is required for snapshots.');
    }
    const result = listSnapshots(config, args.id);
    printJson({
      ok: true,
      action: 'snapshots',
      workspace: result.workspace,
      count: result.snapshots.length,
      snapshots: result.snapshots
    });
    return;
  }

  if (args.command === 'snapshot:create') {
    if (!args.id) {
      throw new Error('Workspace id is required for snapshot:create.');
    }
    const result = await createSnapshot(config, args.id, {
      label: args.label,
      restartAfter: args.restartAfter,
      createdBy: 'workspace-cli'
    });
    printJson({
      ok: true,
      action: 'snapshot:create',
      workspace: result.workspace,
      snapshot: result.snapshot
    });
    return;
  }

  if (args.command === 'snapshot:describe') {
    if (!args.id) {
      throw new Error('Workspace id is required for snapshot:describe.');
    }
    if (!args.snapshotId) {
      throw new Error('Snapshot id is required for snapshot:describe. Use --snapshot <id>.');
    }
    const result = describeSnapshot(config, args.id, args.snapshotId);
    printJson({
      ok: true,
      action: 'snapshot:describe',
      workspace: result.workspace,
      snapshot: result.snapshot
    });
    return;
  }

  if (args.command === 'snapshot:restore') {
    if (!args.id) {
      throw new Error('Workspace id is required for snapshot:restore.');
    }
    if (!args.snapshotId) {
      throw new Error('Snapshot id is required for snapshot:restore. Use --snapshot <id>.');
    }
    const result = await restoreSnapshot(config, args.id, args.snapshotId, {
      restartAfter: args.restartAfter,
      restoredBy: 'workspace-cli'
    });
    printJson({
      ok: true,
      action: 'snapshot:restore',
      workspace: result.workspace,
      snapshot: result.snapshot
    });
    return;
  }

  if (args.command === 'snapshot:delete') {
    if (!args.id) {
      throw new Error('Workspace id is required for snapshot:delete.');
    }
    if (!args.snapshotId) {
      throw new Error('Snapshot id is required for snapshot:delete. Use --snapshot <id>.');
    }
    const result = removeSnapshot(config, args.id, args.snapshotId);
    printJson({
      ok: true,
      action: 'snapshot:delete',
      ...result
    });
    return;
  }

  if (args.command === 'snapshot-retention') {
    const result = getSnapshotRetention(config, args.id || null);
    printJson({
      ok: true,
      action: 'snapshot-retention',
      ...result
    });
    return;
  }

  if (args.command === 'snapshot-retention:set') {
    const policy = setSnapshotRetention(config, {
      scope: args.scope || (args.id ? 'workspace' : args.tenantId ? 'tenant' : 'defaults'),
      mode: args.mode || 'set',
      workspaceId: args.id || null,
      tenantId: args.tenantId || null,
      maxSnapshots: args.maxSnapshots,
      maxAgeDays: args.maxAgeDays
    });
    printJson({
      ok: true,
      action: 'snapshot-retention:set',
      policy
    });
    return;
  }

  if (args.command === 'snapshot-retention:cleanup') {
    const result = runSnapshotRetentionCleanup(config, args.id || null, {
      actorId: 'workspace-cli-retention-cleanup',
      protectSnapshotId: args.snapshotId || null
    });
    printJson({
      ok: true,
      action: 'snapshot-retention:cleanup',
      ...result
    });
    return;
  }

  if (args.command === 'scheduler') {
    const snapshot = getWorkspaceSchedulerSnapshot(config);
    printJson({
      ok: true,
      action: 'scheduler',
      ...snapshot
    });
    return;
  }

  if (args.command === 'scheduler:card') {
    const card = getWorkspaceSchedulerTrendsCompact(config, {
      bucket: args.bucket,
      trigger: args.trigger,
      startAt: args.startAt,
      endAt: args.endAt
    });
    printJson({
      ok: true,
      action: 'scheduler:card',
      ...card
    });
    return;
  }

  if (args.command === 'scheduler:policy:set') {
    const scheduler = createWorkspaceSchedulerController(config);
    const result = scheduler.updatePolicy({
      enabled: args.enabled,
      intervalMs: args.intervalMs,
      healthTimeoutMs: args.healthTimeoutMs,
      maxRestartsPerRun: args.maxRestartsPerRun,
      restartCooldownMs: args.restartCooldownMs,
      cleanupExpiredSessions: args.cleanupExpiredSessions,
      retentionCleanupEnabled: args.retentionCleanupEnabled,
      retentionCleanupEveryRuns: args.retentionCleanupEveryRuns,
      historyMaxEntries: args.historyMaxEntries
    });
    printJson({
      ok: true,
      action: 'scheduler:policy:set',
      ...result
    });
    return;
  }

  if (args.command === 'scheduler:run') {
    const scheduler = createWorkspaceSchedulerController(config);
    const result = await scheduler.runNow({
      trigger: 'cli_manual',
      workspaceId: args.id || null
    });
    printJson({
      ok: true,
      action: 'scheduler:run',
      ...result
    });
    return;
  }

  if (args.command === 'list') {
    const state = listWorkspaces(config);
    printJson({ ok: true, action: 'list', ...state });
    return;
  }

  throw new Error(`Unknown workspace command: ${args.command}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
