import fs from 'node:fs';

import { getInternalUrls } from '../bin/config.mjs';
import {
  createWorkspaceRecord,
  findWorkspaceRecord,
  loadWorkspaceRegistry,
  normalizeWorkspaceId,
  saveWorkspaceRegistry,
  setCurrentWorkspace,
  upsertWorkspaceRecord
} from './workspace-registry.mjs';
import {
  getWorkspaceRuntimeState,
  getWorkspaceRuntimeStatus,
  getWorkspaceSandboxPaths,
  provisionWorkspaceRuntime,
  stopWorkspaceRuntime
} from './workspace-runtime.mjs';
import {
  appendAuditEvent,
  assertForwardedPortCountAllowed,
  assertWorkspaceCreateAllowed
} from './governance-manager.mjs';
import {
  applySnapshotRetentionPolicyForWorkspace,
  createWorkspaceSnapshot,
  deleteWorkspaceSnapshot,
  getWorkspaceSnapshot,
  listWorkspaceSnapshots,
  loadSnapshotRetentionPolicy,
  resolveSnapshotRetentionPolicy,
  restoreWorkspaceSnapshot,
  updateSnapshotRetentionPolicy
} from './snapshot-manager.mjs';

const WORKSPACE_STATUSES = new Set(['ready', 'running', 'stopped', 'error']);

function parsePort(value, label = 'port') {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${label}: '${value}'. Expected integer between 1 and 65535.`);
  }

  return port;
}

function normalizeForwardedHost(host) {
  const normalized = String(host || '').trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\/+$/, '');
}

function normalizePortList(ports) {
  if (!Array.isArray(ports)) {
    throw new Error('forwarded ports must be an array.');
  }

  const seen = new Set();
  const normalized = [];
  for (const value of ports) {
    const port = parsePort(value, 'forwarded port');
    if (!seen.has(port)) {
      seen.add(port);
      normalized.push(port);
    }
  }

  return normalized.sort((a, b) => a - b);
}

function resolveDefaultWorkspaceId(config) {
  const configured = normalizeWorkspaceId(process.env.SKYEQUANTA_DEFAULT_WORKSPACE_ID || process.env.SKYEQUANTA_WORKSPACE_ID);
  return configured || 'local-default';
}

function resolveDefaultTenantId() {
  const tenantId = String(process.env.SKYEQUANTA_DEFAULT_TENANT_ID || process.env.SKYEQUANTA_TENANT_ID || '').trim().toLowerCase();
  return tenantId || 'local';
}

function buildDefaultWorkspaceRecord(config, workspaceId) {
  const internalUrls = getInternalUrls(config);
  return createWorkspaceRecord(workspaceId, {
    name: config.productName,
    status: 'ready',
    ideBaseUrl: internalUrls.ide,
    agentBaseUrl: internalUrls.agentBackend,
    gateBaseUrl: internalUrls.gate,
    source: 'bootstrap',
    tenantId: resolveDefaultTenantId()
  });
}

export function ensureDefaultWorkspace(config) {
  const registry = loadWorkspaceRegistry(config);
  const workspaceId = resolveDefaultWorkspaceId(config);

  let workspace = findWorkspaceRecord(registry, workspaceId);
  if (!workspace) {
    workspace = upsertWorkspaceRecord(registry, buildDefaultWorkspaceRecord(config, workspaceId));
  }

  setCurrentWorkspace(registry, workspace.id);
  saveWorkspaceRegistry(config, registry);
  return {
    registry,
    workspace
  };
}

export function listWorkspaces(config) {
  const registry = loadWorkspaceRegistry(config);
  return {
    count: registry.workspaces.length,
    currentWorkspaceId: registry.currentWorkspaceId,
    workspaces: registry.workspaces
  };
}

export function getWorkspace(config, workspaceId) {
  const registry = loadWorkspaceRegistry(config);
  const resolvedWorkspaceId = workspaceId ? normalizeWorkspaceId(workspaceId) : registry.currentWorkspaceId;
  if (!resolvedWorkspaceId) {
    return null;
  }

  return findWorkspaceRecord(registry, resolvedWorkspaceId);
}

function persistWorkspaceUpdate(config, registry, workspace) {
  upsertWorkspaceRecord(registry, workspace);
  saveWorkspaceRegistry(config, registry);
  return {
    registry,
    workspace
  };
}

function toRuntimeRoutes(config, workspace, runtimeState) {
  if (!runtimeState?.urls?.ide || !runtimeState?.urls?.agent) {
    return workspace.routes;
  }

  return {
    ...(workspace.routes || {}),
    ideBaseUrl: runtimeState.urls.ide,
    agentBaseUrl: runtimeState.urls.agent,
    bridgePathPrefix: workspace?.routes?.bridgePathPrefix || `/w/${workspace.id}`
  };
}

function toRuntimeMetadata(config, workspace, runtimeState, reason) {
  const paths = getWorkspaceSandboxPaths(config, workspace.id);
  return {
    ...(workspace.metadata || {}),
    runtimeDriver: runtimeState?.driver || 'process-sandbox',
    runtimeRootDir: paths.instanceDir,
    runtimeFsDir: paths.fsDir,
    runtimeIdePort: runtimeState?.ports?.ide || null,
    runtimeAgentPort: runtimeState?.ports?.agent || null,
    lastStatusReason: reason || null
  };
}

function requireWorkspace(registry, workspaceId) {
  const workspace = findWorkspaceRecord(registry, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  return workspace;
}

export function selectWorkspace(config, workspaceId) {
  const registry = loadWorkspaceRegistry(config);
  const workspace = requireWorkspace(registry, workspaceId);
  setCurrentWorkspace(registry, workspace.id);
  saveWorkspaceRegistry(config, registry);
  return {
    registry,
    workspace,
    selected: true
  };
}

export function updateWorkspaceStatus(config, workspaceId, status, reason = null) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!WORKSPACE_STATUSES.has(normalizedStatus)) {
    throw new Error(`Invalid workspace status '${status}'. Allowed: ${Array.from(WORKSPACE_STATUSES).join(', ')}`);
  }

  const registry = loadWorkspaceRegistry(config);
  const workspace = requireWorkspace(registry, workspaceId);
  const updated = {
    ...workspace,
    status: normalizedStatus,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(workspace.metadata || {}),
      lastStatusReason: reason || null
    }
  };

  return persistWorkspaceUpdate(config, registry, updated);
}

export async function startWorkspace(config, workspaceId, reason = 'manual_start') {
  const registry = loadWorkspaceRegistry(config);
  const workspace = requireWorkspace(registry, workspaceId);
  const runtime = await provisionWorkspaceRuntime(config, workspace);
  const updated = {
    ...workspace,
    status: 'running',
    updatedAt: new Date().toISOString(),
    routes: toRuntimeRoutes(config, workspace, runtime.state),
    metadata: toRuntimeMetadata(config, workspace, runtime.state, reason)
  };
  const result = persistWorkspaceUpdate(config, registry, updated);
  appendAuditEvent(config, {
    action: 'workspace.start',
    workspaceId: updated.id,
    tenantId: updated?.metadata?.tenantId,
    detail: { reason }
  });
  return {
    ...result,
    action: 'start',
    runtime: getWorkspaceRuntimeStatus(config, updated)
  };
}

export async function stopWorkspace(config, workspaceId, reason = 'manual_stop') {
  const registry = loadWorkspaceRegistry(config);
  const workspace = requireWorkspace(registry, workspaceId);
  await stopWorkspaceRuntime(config, workspace.id);
  const updated = {
    ...workspace,
    status: 'stopped',
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(workspace.metadata || {}),
      lastStatusReason: reason || null
    }
  };
  const result = persistWorkspaceUpdate(config, registry, updated);
  appendAuditEvent(config, {
    action: 'workspace.stop',
    workspaceId: updated.id,
    tenantId: updated?.metadata?.tenantId,
    detail: { reason }
  });
  return {
    ...result,
    action: 'stop',
    runtime: getWorkspaceRuntimeStatus(config, updated)
  };
}

export function getCurrentWorkspace(config) {
  const registry = loadWorkspaceRegistry(config);
  if (!registry.currentWorkspaceId) {
    return null;
  }

  return findWorkspaceRecord(registry, registry.currentWorkspaceId);
}

export async function deleteWorkspace(config, workspaceId, options = {}) {
  const registry = loadWorkspaceRegistry(config);
  const workspace = requireWorkspace(registry, workspaceId);

  await stopWorkspaceRuntime(config, workspace.id);
  const sandboxPaths = getWorkspaceSandboxPaths(config, workspace.id);
  fs.rmSync(sandboxPaths.instanceDir, { recursive: true, force: true });
  fs.rmSync(sandboxPaths.runtimeDir, { recursive: true, force: true });

  const snapshots = listWorkspaceSnapshots(config, workspace.id);
  const removedSnapshotIds = [];
  for (const snapshot of snapshots) {
    const result = deleteWorkspaceSnapshot(config, workspace.id, snapshot.id, {
      tenantId: workspace?.metadata?.tenantId,
      deletedBy: String(options.deletedBy || 'workspace-delete').trim() || 'workspace-delete'
    });
    if (result.deleted) {
      removedSnapshotIds.push(snapshot.id);
    }
  }

  registry.workspaces = registry.workspaces.filter(item => item.id !== workspace.id);
  if (registry.currentWorkspaceId === workspace.id) {
    registry.currentWorkspaceId = registry.workspaces[0]?.id || null;
  }

  saveWorkspaceRegistry(config, registry);

  if (!registry.currentWorkspaceId) {
    ensureDefaultWorkspace(config);
  }

  appendAuditEvent(config, {
    action: 'workspace.delete',
    workspaceId: workspace.id,
    tenantId: workspace?.metadata?.tenantId,
    actorType: 'system',
    actorId: String(options.deletedBy || 'workspace-delete').trim() || 'workspace-delete',
    detail: {
      removedSnapshotIds,
      removedSnapshotCount: removedSnapshotIds.length
    }
  });

  return {
    deleted: true,
    workspaceId: workspace.id,
    removedSnapshotIds,
    removedSnapshotCount: removedSnapshotIds.length
  };
}

export function createWorkspace(config, workspaceId, options = {}) {
  const registry = loadWorkspaceRegistry(config);
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) {
    throw new Error('Workspace id is required.');
  }

  const existing = findWorkspaceRecord(registry, id);
  if (existing) {
    return {
      registry,
      workspace: existing,
      created: false
    };
  }

  assertWorkspaceCreateAllowed(config, registry.workspaces.length);

  const internalUrls = getInternalUrls(config);
  const tenantId = String(options.tenantId || resolveDefaultTenantId()).trim().toLowerCase() || 'local';
  const runtimePaths = getWorkspaceSandboxPaths(config, id);
  const workspace = upsertWorkspaceRecord(
    registry,
    createWorkspaceRecord(id, {
      name: options.name || id,
      status: 'ready',
      ideBaseUrl: options.ideBaseUrl || internalUrls.ide,
      agentBaseUrl: options.agentBaseUrl || internalUrls.agentBackend,
      gateBaseUrl: options.gateBaseUrl || internalUrls.gate,
      source: options.source || 'manual',
      tenantId
    })
  );

  workspace.metadata = {
    ...(workspace.metadata || {}),
    runtimeDriver: 'process-sandbox',
    runtimeRootDir: runtimePaths.instanceDir,
    runtimeFsDir: runtimePaths.fsDir,
    runtimeIdePort: null,
    runtimeAgentPort: null
  };

  if (!registry.currentWorkspaceId) {
    setCurrentWorkspace(registry, workspace.id);
  }

  saveWorkspaceRegistry(config, registry);
  appendAuditEvent(config, {
    action: 'workspace.create',
    workspaceId: workspace.id,
    tenantId: workspace?.metadata?.tenantId,
    actorType: 'system',
    actorId: String(options.source || 'manual').trim() || 'manual',
    detail: {
      name: workspace.name,
      created: true
    }
  });
  return {
    registry,
    workspace,
    created: true
  };
}

export function listWorkspacePorts(config, workspaceId) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  const metadata = workspace.metadata || {};
  return {
    workspace,
    forwardedHost: metadata.forwardedHost || null,
    forwardedPorts: Array.isArray(metadata.forwardedPorts) ? metadata.forwardedPorts : []
  };
}

export function setWorkspacePorts(config, workspaceId, ports, options = {}) {
  const registry = loadWorkspaceRegistry(config);
  const workspace = requireWorkspace(registry, workspaceId);
  const nextPorts = normalizePortList(ports);
  assertForwardedPortCountAllowed(config, nextPorts.length);
  const forwardedHost = options.forwardedHost === undefined
    ? workspace?.metadata?.forwardedHost || null
    : normalizeForwardedHost(options.forwardedHost);

  const updated = {
    ...workspace,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(workspace.metadata || {}),
      forwardedPorts: nextPorts,
      forwardedHost
    }
  };

  const result = persistWorkspaceUpdate(config, registry, updated);
  appendAuditEvent(config, {
    action: 'workspace.ports.set',
    workspaceId: updated.id,
    tenantId: updated?.metadata?.tenantId,
    detail: {
      forwardedPorts: nextPorts,
      forwardedHost
    }
  });
  return result;
}

export function allowWorkspacePort(config, workspaceId, port, options = {}) {
  const current = listWorkspacePorts(config, workspaceId);
  const parsedPort = parsePort(port);
  const nextPorts = [...current.forwardedPorts, parsedPort]
    .filter((value, index, self) => self.indexOf(value) === index)
    .sort((a, b) => a - b);

  return setWorkspacePorts(config, workspaceId, nextPorts, {
    forwardedHost: options.forwardedHost === undefined ? current.forwardedHost : options.forwardedHost
  });
}

export function denyWorkspacePort(config, workspaceId, port) {
  const current = listWorkspacePorts(config, workspaceId);
  const parsedPort = parsePort(port);
  const nextPorts = current.forwardedPorts.filter(item => item !== parsedPort);
  return setWorkspacePorts(config, workspaceId, nextPorts, {
    forwardedHost: current.forwardedHost
  });
}

export function getWorkspaceRuntime(config, workspaceId) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  const runtime = getWorkspaceRuntimeStatus(config, workspace);
  return {
    workspace,
    runtime,
    state: getWorkspaceRuntimeState(config, workspace.id)
  };
}

export function listSnapshots(config, workspaceId) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  return {
    workspace,
    snapshots: listWorkspaceSnapshots(config, workspace.id)
  };
}

export async function createSnapshot(config, workspaceId, options = {}) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  const snapshot = await createWorkspaceSnapshot(config, workspace, options);
  const registry = loadWorkspaceRegistry(config);
  const current = requireWorkspace(registry, workspace.id);
  const updated = {
    ...current,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(current.metadata || {}),
      lastSnapshotId: snapshot.id,
      lastSnapshotAt: snapshot.createdAt
    }
  };

  persistWorkspaceUpdate(config, registry, updated);
  return {
    workspace: updated,
    snapshot
  };
}

export async function restoreSnapshot(config, workspaceId, snapshotId, options = {}) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  const snapshot = await restoreWorkspaceSnapshot(config, workspace, snapshotId, options);
  const registry = loadWorkspaceRegistry(config);
  const current = requireWorkspace(registry, workspace.id);
  const updated = {
    ...current,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(current.metadata || {}),
      lastRestoredSnapshotId: snapshot.id,
      lastRestoredSnapshotAt: new Date().toISOString()
    }
  };

  persistWorkspaceUpdate(config, registry, updated);
  return {
    workspace: updated,
    snapshot
  };
}

export function describeSnapshot(config, workspaceId, snapshotId) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  const snapshot = getWorkspaceSnapshot(config, workspace.id, snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot '${snapshotId}' was not found for workspace '${workspace.id}'.`);
  }

  return {
    workspace,
    snapshot
  };
}

export function removeSnapshot(config, workspaceId, snapshotId) {
  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  return {
    workspace,
    ...deleteWorkspaceSnapshot(config, workspace.id, snapshotId, {
      tenantId: workspace?.metadata?.tenantId,
      deletedBy: 'workspace-manager'
    })
  };
}

export function getSnapshotRetention(config, workspaceId = null) {
  const policy = loadSnapshotRetentionPolicy(config);
  if (!workspaceId) {
    return {
      policy,
      effective: null,
      workspace: null
    };
  }

  const workspace = getWorkspace(config, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' is not registered.`);
  }

  return {
    policy,
    effective: resolveSnapshotRetentionPolicy(config, workspace),
    workspace
  };
}

export function setSnapshotRetention(config, options = {}) {
  return updateSnapshotRetentionPolicy(config, options);
}

export function runSnapshotRetentionCleanup(config, workspaceId = null, options = {}) {
  if (workspaceId) {
    const workspace = getWorkspace(config, workspaceId);
    if (!workspace) {
      throw new Error(`Workspace '${workspaceId}' is not registered.`);
    }

    return {
      cleaned: 1,
      results: [applySnapshotRetentionPolicyForWorkspace(config, workspace, options)]
    };
  }

  const state = listWorkspaces(config);
  const results = state.workspaces.map(workspace => applySnapshotRetentionPolicyForWorkspace(config, workspace, options));
  return {
    cleaned: results.length,
    results
  };
}
