import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
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

function defaultPolicy(config) {
  const limits = config?.governance?.limits || {};
  return {
    version: 1,
    limits: {
      maxWorkspaces: readInteger(limits.maxWorkspaces, 16),
      maxSessions: readInteger(limits.maxSessions, 256),
      maxForwardedPortsPerWorkspace: readInteger(limits.maxForwardedPortsPerWorkspace, 16),
      maxSnapshotsPerWorkspace: readInteger(limits.maxSnapshotsPerWorkspace, 20),
      maxSnapshotBytes: readInteger(limits.maxSnapshotBytes, 5 * 1024 * 1024 * 1024),
      maxAuditEvents: readInteger(limits.maxAuditEvents, 2000)
    }
  };
}

function normalizeTenantId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'local';
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseTimestampMs(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid timestamp '${value}'. Expected ISO-8601 date/time.`);
  }

  return parsed;
}

function pruneAuditEvents(policy, events) {
  const maxEvents = readInteger(policy?.limits?.maxAuditEvents, 2000);
  if (events.length <= maxEvents) {
    return events;
  }

  return events.slice(events.length - maxEvents);
}

export function getGovernancePolicyPath(config) {
  return path.join(config.rootDir, '.skyequanta', 'governance-policy.json');
}

export function getAuditLogPath(config) {
  return path.join(config.rootDir, '.skyequanta', 'audit-log.json');
}

export function loadGovernancePolicy(config) {
  const policyPath = getGovernancePolicyPath(config);
  const parsed = readJson(policyPath, null);
  const defaults = defaultPolicy(config);
  if (!parsed || typeof parsed !== 'object') {
    return defaults;
  }

  return {
    version: 1,
    limits: {
      ...defaults.limits,
      ...(parsed.limits || {})
    }
  };
}

export function saveGovernancePolicy(config, policy) {
  const next = {
    version: 1,
    limits: {
      ...defaultPolicy(config).limits,
      ...(policy?.limits || {})
    }
  };

  writeJson(getGovernancePolicyPath(config), next);
  return next;
}

export function ensureGovernanceStores(config) {
  const policy = loadGovernancePolicy(config);
  saveGovernancePolicy(config, policy);
  if (!fs.existsSync(getAuditLogPath(config))) {
    writeJson(getAuditLogPath(config), {
      version: 1,
      events: []
    });
  }

  return {
    policyPath: getGovernancePolicyPath(config),
    auditLogPath: getAuditLogPath(config)
  };
}

function loadAuditStore(config) {
  return readJson(getAuditLogPath(config), {
    version: 1,
    events: []
  });
}

function saveAuditStore(config, store) {
  writeJson(getAuditLogPath(config), {
    version: 1,
    events: Array.isArray(store?.events) ? store.events : []
  });
}

export function appendAuditEvent(config, event) {
  const policy = loadGovernancePolicy(config);
  const store = loadAuditStore(config);
  const nextEvent = {
    id: crypto.randomUUID(),
    at: nowIso(),
    action: String(event?.action || 'unknown').trim(),
    outcome: String(event?.outcome || 'success').trim(),
    actorType: String(event?.actorType || 'system').trim(),
    actorId: String(event?.actorId || 'system').trim(),
    tenantId: normalizeTenantId(event?.tenantId),
    workspaceId: String(event?.workspaceId || '').trim() || null,
    sessionId: String(event?.sessionId || '').trim() || null,
    detail: event?.detail || {}
  };

  const existing = Array.isArray(store.events) ? store.events : [];
  store.events = pruneAuditEvents(policy, [...existing, nextEvent]);
  saveAuditStore(config, store);
  return nextEvent;
}

export function listAuditEvents(config, options = {}) {
  const limit = readInteger(options.limit, 100);
  const offset = normalizeOffset(options.offset);
  const workspaceId = String(options.workspaceId || '').trim();
  const tenantId = options.tenantId ? normalizeTenantId(options.tenantId) : '';
  const startAtMs = parseTimestampMs(options.startAt, null);
  const endAtMs = parseTimestampMs(options.endAt, null);
  if (startAtMs !== null && endAtMs !== null && startAtMs > endAtMs) {
    throw new Error('Invalid audit window: startAt must be less than or equal to endAt.');
  }

  const store = loadAuditStore(config);
  const filtered = (Array.isArray(store.events) ? store.events : [])
    .filter(event => {
      if (workspaceId && event.workspaceId !== workspaceId) {
        return false;
      }

      if (tenantId && event.tenantId !== tenantId) {
        return false;
      }

      const eventAtMs = Date.parse(String(event.at || ''));
      if (startAtMs !== null && Number.isFinite(eventAtMs) && eventAtMs < startAtMs) {
        return false;
      }

      if (endAtMs !== null && Number.isFinite(eventAtMs) && eventAtMs > endAtMs) {
        return false;
      }

      return true;
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    total: filtered.length,
    offset,
    limit,
    hasMore: nextOffset < filtered.length,
    nextOffset: nextOffset < filtered.length ? nextOffset : null,
    events: page
  };
}

export function assertWorkspaceCreateAllowed(config, workspaceCount) {
  const policy = loadGovernancePolicy(config);
  if (workspaceCount >= policy.limits.maxWorkspaces) {
    throw new Error(`Workspace limit reached (${policy.limits.maxWorkspaces}).`);
  }
}

export function assertSessionOpenAllowed(config, sessionCount) {
  const policy = loadGovernancePolicy(config);
  if (sessionCount >= policy.limits.maxSessions) {
    throw new Error(`Session limit reached (${policy.limits.maxSessions}).`);
  }
}

export function assertForwardedPortCountAllowed(config, portCount) {
  const policy = loadGovernancePolicy(config);
  if (portCount > policy.limits.maxForwardedPortsPerWorkspace) {
    throw new Error(`Forwarded port limit exceeded (${policy.limits.maxForwardedPortsPerWorkspace}).`);
  }
}

export function assertSnapshotQuotaAllowed(config, snapshotCount) {
  const policy = loadGovernancePolicy(config);
  if (snapshotCount >= policy.limits.maxSnapshotsPerWorkspace) {
    throw new Error(`Snapshot limit reached (${policy.limits.maxSnapshotsPerWorkspace}).`);
  }
}

export function assertSnapshotSizeAllowed(config, sizeBytes) {
  const policy = loadGovernancePolicy(config);
  if (sizeBytes > policy.limits.maxSnapshotBytes) {
    throw new Error(`Snapshot size exceeds limit (${policy.limits.maxSnapshotBytes} bytes).`);
  }
}

export function getGovernanceSummary(config, usage = {}) {
  const policy = loadGovernancePolicy(config);
  return {
    policy,
    usage: {
      workspaceCount: readInteger(usage.workspaceCount, 0),
      sessionCount: readInteger(usage.sessionCount, 0),
      snapshotCountByWorkspace: usage.snapshotCountByWorkspace || {}
    }
  };
}
