import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  appendAuditEvent,
  assertSnapshotQuotaAllowed,
  assertSnapshotSizeAllowed
} from './governance-manager.mjs';
import {
  getWorkspaceSandboxPaths,
  getWorkspaceRuntimeStatus,
  provisionWorkspaceRuntime,
  stopWorkspaceRuntime
} from './workspace-runtime.mjs';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWorkspaceId(value) {
  return String(value || '').trim().toLowerCase();
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function readInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function directorySizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += directorySizeBytes(entryPath);
      continue;
    }

    if (entry.isFile()) {
      total += fs.statSync(entryPath).size;
    }
  }

  return total;
}

export function getSnapshotRootDir(config) {
  return path.join(config.rootDir, '.skyequanta', 'snapshots');
}

export function getSnapshotIndexPath(config) {
  return path.join(config.rootDir, '.skyequanta', 'workspace-snapshots.json');
}

export function getSnapshotRetentionPolicyPath(config) {
  return path.join(config.rootDir, '.skyequanta', 'snapshot-retention.json');
}

function defaultRetentionPolicy(config) {
  return {
    version: 1,
    defaults: {
      maxSnapshots: readInteger(config?.governance?.limits?.maxSnapshotsPerWorkspace, 20),
      maxAgeDays: readInteger(process.env.SKYEQUANTA_SNAPSHOT_RETENTION_MAX_AGE_DAYS, 30)
    },
    tenants: {},
    workspaces: {}
  };
}

function normalizeRetentionRule(rule, fallback) {
  if (!rule || typeof rule !== 'object') {
    return {
      ...fallback
    };
  }

  return {
    maxSnapshots: readInteger(rule.maxSnapshots, fallback.maxSnapshots),
    maxAgeDays: readInteger(rule.maxAgeDays, fallback.maxAgeDays)
  };
}

function normalizeRetentionMap(entries, fallback) {
  if (!entries || typeof entries !== 'object') {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(entries)) {
    const id = String(key || '').trim().toLowerCase();
    if (!id) {
      continue;
    }

    normalized[id] = normalizeRetentionRule(value, fallback);
  }

  return normalized;
}

export function loadSnapshotRetentionPolicy(config) {
  const defaults = defaultRetentionPolicy(config);
  const parsed = readJson(getSnapshotRetentionPolicyPath(config), null);
  if (!parsed || typeof parsed !== 'object') {
    return defaults;
  }

  const normalizedDefaults = normalizeRetentionRule(parsed.defaults, defaults.defaults);
  return {
    version: 1,
    defaults: normalizedDefaults,
    tenants: normalizeRetentionMap(parsed.tenants, normalizedDefaults),
    workspaces: normalizeRetentionMap(parsed.workspaces, normalizedDefaults)
  };
}

export function saveSnapshotRetentionPolicy(config, policy) {
  const defaults = defaultRetentionPolicy(config);
  const normalizedDefaults = normalizeRetentionRule(policy?.defaults, defaults.defaults);
  const next = {
    version: 1,
    defaults: normalizedDefaults,
    tenants: normalizeRetentionMap(policy?.tenants, normalizedDefaults),
    workspaces: normalizeRetentionMap(policy?.workspaces, normalizedDefaults)
  };

  writeJson(getSnapshotRetentionPolicyPath(config), next);
  return next;
}

export function resolveSnapshotRetentionPolicy(config, workspace) {
  const policy = loadSnapshotRetentionPolicy(config);
  const workspaceId = String(workspace?.id || '').trim().toLowerCase();
  const tenantId = String(workspace?.metadata?.tenantId || '').trim().toLowerCase();

  const tenantRule = tenantId ? policy.tenants[tenantId] : null;
  const workspaceRule = workspaceId ? policy.workspaces[workspaceId] : null;
  return {
    maxSnapshots: readInteger(workspaceRule?.maxSnapshots, readInteger(tenantRule?.maxSnapshots, policy.defaults.maxSnapshots)),
    maxAgeDays: readInteger(workspaceRule?.maxAgeDays, readInteger(tenantRule?.maxAgeDays, policy.defaults.maxAgeDays))
  };
}

export function updateSnapshotRetentionPolicy(config, options = {}) {
  const scope = String(options.scope || '').trim().toLowerCase() || 'defaults';
  const tenantId = String(options.tenantId || '').trim().toLowerCase();
  const workspaceId = String(options.workspaceId || '').trim().toLowerCase();
  const mode = String(options.mode || 'set').trim().toLowerCase();
  const policy = loadSnapshotRetentionPolicy(config);
  const fallback = policy.defaults;

  if (!['defaults', 'tenant', 'workspace'].includes(scope)) {
    throw new Error(`Invalid retention scope '${scope}'. Use defaults, tenant, or workspace.`);
  }

  if (scope === 'tenant' && !tenantId) {
    throw new Error('tenantId is required for tenant retention scope.');
  }

  if (scope === 'workspace' && !workspaceId) {
    throw new Error('workspaceId is required for workspace retention scope.');
  }

  if (mode === 'clear') {
    if (scope === 'defaults') {
      policy.defaults = defaultRetentionPolicy(config).defaults;
    }

    if (scope === 'tenant') {
      delete policy.tenants[tenantId];
    }

    if (scope === 'workspace') {
      delete policy.workspaces[workspaceId];
    }
  } else {
    const nextRule = normalizeRetentionRule({
      maxSnapshots: options.maxSnapshots,
      maxAgeDays: options.maxAgeDays
    }, fallback);

    if (scope === 'defaults') {
      policy.defaults = nextRule;
    }

    if (scope === 'tenant') {
      policy.tenants[tenantId] = nextRule;
    }

    if (scope === 'workspace') {
      policy.workspaces[workspaceId] = nextRule;
    }
  }

  return saveSnapshotRetentionPolicy(config, policy);
}

function emptySnapshotIndex() {
  return {
    version: 1,
    snapshots: []
  };
}

function normalizeSnapshotRecord(record) {
  return {
    id: String(record?.id || '').trim(),
    workspaceId: normalizeWorkspaceId(record?.workspaceId),
    label: String(record?.label || '').trim() || null,
    createdAt: String(record?.createdAt || nowIso()),
    createdBy: String(record?.createdBy || 'system').trim() || 'system',
    sizeBytes: Number.parseInt(String(record?.sizeBytes ?? '0'), 10) || 0,
    snapshotDir: String(record?.snapshotDir || '').trim(),
    fsDir: String(record?.fsDir || '').trim(),
    manifestPath: String(record?.manifestPath || '').trim()
  };
}

export function loadSnapshotIndex(config) {
  const parsed = readJson(getSnapshotIndexPath(config), null);
  if (!parsed || !Array.isArray(parsed.snapshots)) {
    return emptySnapshotIndex();
  }

  return {
    version: 1,
    snapshots: parsed.snapshots.map(normalizeSnapshotRecord).filter(record => record.id && record.workspaceId)
  };
}

export function saveSnapshotIndex(config, index) {
  const next = {
    version: 1,
    snapshots: Array.isArray(index?.snapshots) ? index.snapshots.map(normalizeSnapshotRecord) : []
  };

  writeJson(getSnapshotIndexPath(config), next);
  return next;
}

export function ensureSnapshotStore(config) {
  ensureDirectory(getSnapshotRootDir(config));
  if (!fs.existsSync(getSnapshotIndexPath(config))) {
    saveSnapshotIndex(config, emptySnapshotIndex());
  }

  if (!fs.existsSync(getSnapshotRetentionPolicyPath(config))) {
    saveSnapshotRetentionPolicy(config, defaultRetentionPolicy(config));
  }

  return {
    snapshotRootDir: getSnapshotRootDir(config),
    snapshotIndexPath: getSnapshotIndexPath(config),
    snapshotRetentionPolicyPath: getSnapshotRetentionPolicyPath(config)
  };
}

function workspaceSnapshotDir(config, workspaceId, snapshotId) {
  return path.join(getSnapshotRootDir(config), workspaceId, snapshotId);
}

function listForWorkspace(index, workspaceId) {
  const normalized = normalizeWorkspaceId(workspaceId);
  return index.snapshots.filter(snapshot => snapshot.workspaceId === normalized);
}

function writeManifest(snapshotRecord, extra = {}) {
  const payload = {
    id: snapshotRecord.id,
    workspaceId: snapshotRecord.workspaceId,
    label: snapshotRecord.label,
    createdAt: snapshotRecord.createdAt,
    createdBy: snapshotRecord.createdBy,
    sizeBytes: snapshotRecord.sizeBytes,
    ...extra
  };

  writeJson(snapshotRecord.manifestPath, payload);
}

export function listWorkspaceSnapshots(config, workspaceId) {
  const index = loadSnapshotIndex(config);
  return listForWorkspace(index, workspaceId).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function getWorkspaceSnapshot(config, workspaceId, snapshotId) {
  const snapshots = listWorkspaceSnapshots(config, workspaceId);
  return snapshots.find(snapshot => snapshot.id === String(snapshotId || '').trim()) || null;
}

function toExpired(snapshot, maxAgeDays, nowMs) {
  const createdAtMs = Date.parse(String(snapshot?.createdAt || ''));
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return createdAtMs < nowMs - maxAgeMs;
}

export function applySnapshotRetentionPolicyForWorkspace(config, workspace, options = {}) {
  const workspaceId = normalizeWorkspaceId(workspace?.id);
  if (!workspaceId) {
    throw new Error('workspace.id is required for snapshot retention cleanup.');
  }

  const retention = resolveSnapshotRetentionPolicy(config, workspace);
  const nowMs = Date.now();
  const snapshots = listWorkspaceSnapshots(config, workspaceId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const protectedId = String(options.protectSnapshotId || '').trim();

  const toDelete = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (protectedId && snapshot.id === protectedId) {
      continue;
    }

    const overCount = index >= retention.maxSnapshots;
    const expired = toExpired(snapshot, retention.maxAgeDays, nowMs);
    if (overCount || expired) {
      toDelete.push(snapshot);
    }
  }

  const removed = [];
  for (const snapshot of toDelete) {
    const result = deleteWorkspaceSnapshot(config, workspaceId, snapshot.id, {
      tenantId: workspace?.metadata?.tenantId,
      deletedBy: options.actorId || 'snapshot-retention-policy'
    });
    if (result.deleted) {
      removed.push(snapshot.id);
    }
  }

  if (removed.length) {
    appendAuditEvent(config, {
      action: 'workspace.snapshot.retention_cleanup',
      workspaceId,
      tenantId: workspace?.metadata?.tenantId,
      actorType: 'system',
      actorId: String(options.actorId || 'snapshot-retention-policy').trim(),
      outcome: 'success',
      detail: {
        removedSnapshotIds: removed,
        retention
      }
    });
  }

  return {
    workspaceId,
    removedSnapshotIds: removed,
    removedCount: removed.length,
    retention
  };
}

export async function createWorkspaceSnapshot(config, workspace, options = {}) {
  const workspaceId = normalizeWorkspaceId(workspace?.id);
  if (!workspaceId) {
    throw new Error('workspace.id is required to create snapshot.');
  }

  ensureSnapshotStore(config);
  const index = loadSnapshotIndex(config);
  const existing = listForWorkspace(index, workspaceId);
  assertSnapshotQuotaAllowed(config, existing.length);

  const paths = getWorkspaceSandboxPaths(config, workspaceId);
  ensureDirectory(paths.fsDir);

  const runtimeStatus = getWorkspaceRuntimeStatus(config, workspace);
  const restartAfter = options.restartAfter !== false;
  const wasRunning = Boolean(runtimeStatus.running);

  if (wasRunning) {
    await stopWorkspaceRuntime(config, workspaceId);
  }

  const snapshotId = crypto.randomUUID();
  const snapshotDir = workspaceSnapshotDir(config, workspaceId, snapshotId);
  const snapshotFsDir = path.join(snapshotDir, 'fs');
  ensureDirectory(snapshotDir);
  fs.cpSync(paths.fsDir, snapshotFsDir, { recursive: true });

  const sizeBytes = directorySizeBytes(snapshotFsDir);
  assertSnapshotSizeAllowed(config, sizeBytes);

  const record = normalizeSnapshotRecord({
    id: snapshotId,
    workspaceId,
    label: String(options.label || '').trim() || null,
    createdAt: nowIso(),
    createdBy: String(options.createdBy || 'system').trim() || 'system',
    sizeBytes,
    snapshotDir,
    fsDir: snapshotFsDir,
    manifestPath: path.join(snapshotDir, 'manifest.json')
  });

  writeManifest(record, {
    workspaceName: String(workspace?.name || workspaceId),
    runtimeWasRunning: wasRunning,
    sourceFsDir: paths.fsDir
  });

  index.snapshots.push(record);
  saveSnapshotIndex(config, index);

  if (wasRunning && restartAfter) {
    await provisionWorkspaceRuntime(config, workspace);
  }

  appendAuditEvent(config, {
    action: 'workspace.snapshot.create',
    workspaceId,
    tenantId: workspace?.metadata?.tenantId,
    actorType: 'system',
    actorId: String(options.createdBy || 'system').trim() || 'system',
    outcome: 'success',
    detail: {
      snapshotId: record.id,
      sizeBytes: record.sizeBytes,
      restartAfter,
      wasRunning
    }
  });

  applySnapshotRetentionPolicyForWorkspace(config, workspace, {
    protectSnapshotId: record.id,
    actorId: String(options.createdBy || 'system').trim() || 'system'
  });

  return record;
}

export async function restoreWorkspaceSnapshot(config, workspace, snapshotId, options = {}) {
  const workspaceId = normalizeWorkspaceId(workspace?.id);
  const snapshot = getWorkspaceSnapshot(config, workspaceId, snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot '${snapshotId}' was not found for workspace '${workspaceId}'.`);
  }

  if (!fs.existsSync(snapshot.fsDir)) {
    throw new Error(`Snapshot filesystem path is missing: ${snapshot.fsDir}`);
  }

  const runtimeStatus = getWorkspaceRuntimeStatus(config, workspace);
  const restartAfter = options.restartAfter !== false;
  const wasRunning = Boolean(runtimeStatus.running);

  if (wasRunning) {
    await stopWorkspaceRuntime(config, workspaceId);
  }

  const paths = getWorkspaceSandboxPaths(config, workspaceId);
  fs.rmSync(paths.fsDir, { recursive: true, force: true });
  ensureDirectory(paths.fsDir);
  fs.cpSync(snapshot.fsDir, paths.fsDir, { recursive: true });

  if (wasRunning && restartAfter) {
    await provisionWorkspaceRuntime(config, workspace);
  }

  appendAuditEvent(config, {
    action: 'workspace.snapshot.restore',
    workspaceId,
    tenantId: workspace?.metadata?.tenantId,
    actorType: 'system',
    actorId: String(options.restoredBy || 'system').trim() || 'system',
    outcome: 'success',
    detail: {
      snapshotId: snapshot.id,
      restartAfter,
      wasRunning
    }
  });

  return snapshot;
}

export function deleteWorkspaceSnapshot(config, workspaceId, snapshotId, options = {}) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const normalizedSnapshotId = String(snapshotId || '').trim();
  const index = loadSnapshotIndex(config);
  const target = index.snapshots.find(
    snapshot => snapshot.workspaceId === normalizedWorkspaceId && snapshot.id === normalizedSnapshotId
  );

  if (!target) {
    return {
      deleted: false,
      reason: 'snapshot_not_found'
    };
  }

  index.snapshots = index.snapshots.filter(
    snapshot => !(snapshot.workspaceId === normalizedWorkspaceId && snapshot.id === normalizedSnapshotId)
  );
  saveSnapshotIndex(config, index);
  fs.rmSync(target.snapshotDir, { recursive: true, force: true });

  appendAuditEvent(config, {
    action: 'workspace.snapshot.delete',
    workspaceId: normalizedWorkspaceId,
    tenantId: options.tenantId,
    actorType: 'system',
    actorId: String(options.deletedBy || 'system').trim() || 'system',
    outcome: 'success',
    detail: {
      snapshotId: normalizedSnapshotId
    }
  });

  return {
    deleted: true,
    snapshotId: normalizedSnapshotId
  };
}

export function countSnapshotsByWorkspace(config) {
  const index = loadSnapshotIndex(config);
  const counts = {};
  for (const snapshot of index.snapshots) {
    counts[snapshot.workspaceId] = (counts[snapshot.workspaceId] || 0) + 1;
  }

  return counts;
}
