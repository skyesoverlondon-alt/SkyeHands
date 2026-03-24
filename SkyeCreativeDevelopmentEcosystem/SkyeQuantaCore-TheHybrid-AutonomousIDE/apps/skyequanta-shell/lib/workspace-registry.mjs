import fs from 'node:fs';
import path from 'node:path';

const REGISTRY_VERSION = 1;

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\/+$/, '');
}

function normalizeForwardedPorts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    const port = Number.parseInt(String(entry), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      continue;
    }

    if (!seen.has(port)) {
      seen.add(port);
      normalized.push(port);
    }
  }

  return normalized.sort((a, b) => a - b);
}

function normalizeWorkspaceRecord(record) {
  const metadata = record && typeof record.metadata === 'object' && record.metadata !== null ? record.metadata : {};
  const tenantId = String(metadata.tenantId || '').trim().toLowerCase() || 'local';
  return {
    ...record,
    metadata: {
      ...metadata,
      tenantId,
      forwardedPorts: normalizeForwardedPorts(metadata.forwardedPorts),
      forwardedHost: normalizeUrl(metadata.forwardedHost) || null
    }
  };
}

export function getWorkspaceRegistryPath(config) {
  return path.join(config.rootDir, '.skyequanta', 'workspaces.json');
}

function emptyRegistry() {
  return {
    version: REGISTRY_VERSION,
    currentWorkspaceId: null,
    workspaces: []
  };
}

export function loadWorkspaceRegistry(config) {
  const registryPath = getWorkspaceRegistryPath(config);
  if (!fs.existsSync(registryPath)) {
    return emptyRegistry();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces.map(normalizeWorkspaceRecord) : [];
    return {
      version: REGISTRY_VERSION,
      currentWorkspaceId: typeof parsed.currentWorkspaceId === 'string' ? parsed.currentWorkspaceId : null,
      workspaces
    };
  } catch {
    return emptyRegistry();
  }
}

export function saveWorkspaceRegistry(config, registry) {
  const registryPath = getWorkspaceRegistryPath(config);
  ensureDirectory(path.dirname(registryPath));
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return registryPath;
}

export function createWorkspaceRecord(id, options = {}) {
  const normalizedId = normalizeId(id);
  if (!normalizedId) {
    throw new Error('Workspace id is required.');
  }

  const timestamp = nowIso();
  const name = String(options.name || normalizedId).trim() || normalizedId;
  const bridgePathPrefix = `/w/${normalizedId}`;
  return {
    id: normalizedId,
    name,
    status: options.status || 'ready',
    createdAt: timestamp,
    updatedAt: timestamp,
    routes: {
      ideBaseUrl: normalizeUrl(options.ideBaseUrl),
      agentBaseUrl: normalizeUrl(options.agentBaseUrl),
      gateBaseUrl: normalizeUrl(options.gateBaseUrl),
      bridgePathPrefix
    },
    metadata: {
      source: options.source || 'shell',
      tenantId: String(options.tenantId || '').trim().toLowerCase() || 'local',
      forwardedPorts: normalizeForwardedPorts(options.forwardedPorts),
      forwardedHost: normalizeUrl(options.forwardedHost) || null
    }
  };
}

export function upsertWorkspaceRecord(registry, record) {
  const index = registry.workspaces.findIndex(workspace => workspace.id === record.id);
  if (index >= 0) {
    const updated = normalizeWorkspaceRecord({
      ...registry.workspaces[index],
      ...record,
      updatedAt: nowIso()
    });
    registry.workspaces[index] = updated;
    return updated;
  }

  const normalized = normalizeWorkspaceRecord(record);
  registry.workspaces.push(normalized);
  return normalized;
}

export function findWorkspaceRecord(registry, workspaceId) {
  const normalized = normalizeId(workspaceId);
  if (!normalized) {
    return null;
  }

  return registry.workspaces.find(workspace => workspace.id === normalized) || null;
}

export function setCurrentWorkspace(registry, workspaceId) {
  const workspace = findWorkspaceRecord(registry, workspaceId);
  registry.currentWorkspaceId = workspace ? workspace.id : null;
  return registry.currentWorkspaceId;
}

export function normalizeWorkspaceId(value) {
  return normalizeId(value);
}
