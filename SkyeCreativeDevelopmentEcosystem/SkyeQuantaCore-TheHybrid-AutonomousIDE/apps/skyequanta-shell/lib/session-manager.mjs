import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAuditEvent, assertSessionOpenAllowed } from './governance-manager.mjs';

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function readInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

export function getSessionStorePath(config) {
  return path.join(config.rootDir, '.skyequanta', 'sessions.json');
}

function emptyStore() {
  return {
    version: 1,
    sessions: []
  };
}

function normalizeTenantId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'local';
}

function normalizeSessionRecord(record) {
  const now = nowMs();
  const expiresAtMs = readInteger(record?.expiresAtMs, now);
  return {
    id: String(record?.id || '').trim(),
    tenantId: normalizeTenantId(record?.tenantId),
    workspaceId: String(record?.workspaceId || '').trim(),
    clientName: String(record?.clientName || 'unknown').trim() || 'unknown',
    accessToken: String(record?.accessToken || '').trim(),
    reconnectToken: String(record?.reconnectToken || '').trim(),
    authSource: String(record?.authSource || 'local-session').trim() || 'local-session',
    gateSessionId: String(record?.gateSessionId || '').trim() || null,
    gateAppId: String(record?.gateAppId || '').trim() || null,
    gateOrgId: String(record?.gateOrgId || '').trim() || null,
    gateAuthMode: String(record?.gateAuthMode || '').trim() || null,
    founderGateway: Boolean(record?.founderGateway),
    gateExpiresAt: String(record?.gateExpiresAt || '').trim() || null,
    createdAt: String(record?.createdAt || nowIso()),
    lastSeenAt: String(record?.lastSeenAt || nowIso()),
    expiresAt: String(record?.expiresAt || new Date(expiresAtMs).toISOString()),
    expiresAtMs
  };
}

function pruneExpired(store) {
  const now = nowMs();
  store.sessions = store.sessions.filter(session => session.expiresAtMs > now);
  return store;
}

function loadSessionStore(config) {
  const storePath = getSessionStorePath(config);
  if (!fs.existsSync(storePath)) {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeSessionRecord) : [];
    return pruneExpired({
      version: 1,
      sessions
    });
  } catch {
    return emptyStore();
  }
}

function saveSessionStore(config, store) {
  const storePath = getSessionStorePath(config);
  ensureDirectory(path.dirname(storePath));
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  return storePath;
}

export function cleanupExpiredSessions(config, options = {}) {
  const before = loadSessionStore(config);
  const beforeCount = before.sessions.length;
  const pruned = pruneExpired(before);
  const afterCount = pruned.sessions.length;
  const removed = Math.max(0, beforeCount - afterCount);
  saveSessionStore(config, pruned);

  if (removed > 0) {
    appendAuditEvent(config, {
      action: 'session.cleanup',
      actorType: 'system',
      actorId: String(options.actorId || 'session-cleanup').trim() || 'session-cleanup',
      detail: {
        removed,
        beforeCount,
        afterCount
      }
    });
  }

  return {
    removed,
    beforeCount,
    afterCount
  };
}

function getSessionTtlMs(config) {
  return readInteger(process.env.SKYEQUANTA_SESSION_TTL_MS, 2 * 60 * 60 * 1000);
}

function getSessionByAccessToken(store, accessToken) {
  return store.sessions.find(session => session.accessToken === accessToken) || null;
}

function getSessionById(store, sessionId) {
  return store.sessions.find(session => session.id === sessionId) || null;
}

function refreshSessionLifetime(config, session) {
  const ttlMs = getSessionTtlMs(config);
  const nextMs = nowMs() + ttlMs;
  return {
    ...session,
    lastSeenAt: nowIso(),
    expiresAtMs: nextMs,
    expiresAt: new Date(nextMs).toISOString()
  };
}

function updateSession(store, nextSession) {
  const index = store.sessions.findIndex(item => item.id === nextSession.id);
  if (index === -1) {
    store.sessions.push(nextSession);
    return nextSession;
  }

  store.sessions[index] = nextSession;
  return nextSession;
}

export function openSession(config, options = {}) {
  const workspaceId = String(options.workspaceId || '').trim();
  if (!workspaceId) {
    throw new Error('workspaceId is required to open a session.');
  }

  const tenantId = normalizeTenantId(options.tenantId);
  const clientName = String(options.clientName || 'unknown').trim() || 'unknown';
  const ttlMs = getSessionTtlMs(config);
  const now = nowMs();
  const expiresAtMs = now + ttlMs;
  const session = {
    id: crypto.randomUUID(),
    tenantId,
    workspaceId,
    clientName,
    accessToken: randomToken(),
    reconnectToken: randomToken(),
    authSource: String(options.authSource || 'local-session').trim() || 'local-session',
    gateSessionId: String(options.gateSessionId || '').trim() || null,
    gateAppId: String(options.gateAppId || '').trim() || null,
    gateOrgId: String(options.gateOrgId || '').trim() || null,
    gateAuthMode: String(options.gateAuthMode || '').trim() || null,
    founderGateway: Boolean(options.founderGateway),
    gateExpiresAt: String(options.gateExpiresAt || '').trim() || null,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    expiresAtMs,
    expiresAt: new Date(expiresAtMs).toISOString()
  };

  const store = pruneExpired(loadSessionStore(config));
  assertSessionOpenAllowed(config, store.sessions.length);
  store.sessions.push(session);
  saveSessionStore(config, store);
  appendAuditEvent(config, {
    action: 'session.open',
    workspaceId: workspaceId,
    tenantId,
    sessionId: session.id,
    actorType: 'client',
    actorId: clientName,
    detail: {
      clientName,
      authSource: session.authSource,
      gateSessionId: session.gateSessionId,
      gateAppId: session.gateAppId,
      gateOrgId: session.gateOrgId,
      gateAuthMode: session.gateAuthMode,
      founderGateway: session.founderGateway
    }
  });
  return session;
}

export function listSessions(config, tenantId = null) {
  const store = pruneExpired(loadSessionStore(config));
  if (!tenantId) {
    return store.sessions;
  }

  const normalizedTenant = normalizeTenantId(tenantId);
  return store.sessions.filter(session => session.tenantId === normalizedTenant);
}

export function validateAccessToken(config, accessToken, constraints = {}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    return null;
  }

  const store = pruneExpired(loadSessionStore(config));
  const session = getSessionByAccessToken(store, token);
  if (!session) {
    return null;
  }

  const tenantId = constraints.tenantId ? normalizeTenantId(constraints.tenantId) : null;
  const workspaceId = constraints.workspaceId ? String(constraints.workspaceId).trim() : null;
  if (tenantId && session.tenantId !== tenantId) {
    return null;
  }

  if (workspaceId && session.workspaceId !== workspaceId) {
    return null;
  }

  const refreshed = refreshSessionLifetime(config, session);
  updateSession(store, refreshed);
  saveSessionStore(config, store);
  return refreshed;
}

export function reconnectSession(config, sessionId, reconnectToken) {
  const id = String(sessionId || '').trim();
  const token = String(reconnectToken || '').trim();
  if (!id || !token) {
    throw new Error('sessionId and reconnectToken are required.');
  }

  const store = pruneExpired(loadSessionStore(config));
  const session = getSessionById(store, id);
  if (!session || session.reconnectToken !== token) {
    throw new Error('Invalid session reconnect credentials.');
  }

  const rotated = refreshSessionLifetime(config, {
    ...session,
    accessToken: randomToken()
  });
  updateSession(store, rotated);
  saveSessionStore(config, store);
  appendAuditEvent(config, {
    action: 'session.reconnect',
    workspaceId: rotated.workspaceId,
    tenantId: rotated.tenantId,
    sessionId: rotated.id,
    actorType: 'client',
    actorId: rotated.clientName
  });
  return rotated;
}

export function heartbeatSession(config, sessionId, accessToken) {
  const id = String(sessionId || '').trim();
  const token = String(accessToken || '').trim();
  if (!id || !token) {
    throw new Error('sessionId and accessToken are required.');
  }

  const store = pruneExpired(loadSessionStore(config));
  const session = getSessionById(store, id);
  if (!session || session.accessToken !== token) {
    throw new Error('Invalid session heartbeat credentials.');
  }

  const refreshed = refreshSessionLifetime(config, session);
  updateSession(store, refreshed);
  saveSessionStore(config, store);
  appendAuditEvent(config, {
    action: 'session.heartbeat',
    workspaceId: refreshed.workspaceId,
    tenantId: refreshed.tenantId,
    sessionId: refreshed.id,
    actorType: 'client',
    actorId: refreshed.clientName
  });
  return refreshed;
}

export function closeSession(config, sessionId, accessToken = null) {
  const id = String(sessionId || '').trim();
  if (!id) {
    throw new Error('sessionId is required.');
  }

  const token = accessToken === null ? null : String(accessToken || '').trim();
  const store = pruneExpired(loadSessionStore(config));
  const session = getSessionById(store, id);
  if (!session) {
    return {
      closed: false,
      reason: 'session_not_found'
    };
  }

  if (token && session.accessToken !== token) {
    throw new Error('Invalid session close credentials.');
  }

  store.sessions = store.sessions.filter(item => item.id !== id);
  saveSessionStore(config, store);
  appendAuditEvent(config, {
    action: 'session.close',
    workspaceId: session.workspaceId,
    tenantId: session.tenantId,
    sessionId: session.id,
    actorType: 'client',
    actorId: session.clientName
  });
  return {
    closed: true,
    sessionId: id
  };
}
