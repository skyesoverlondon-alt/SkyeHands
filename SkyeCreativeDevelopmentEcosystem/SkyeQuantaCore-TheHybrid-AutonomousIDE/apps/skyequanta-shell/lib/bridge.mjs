import http from 'node:http';

import { getInternalUrls, getPublicUrls, getRuntimeContract } from '../bin/config.mjs';
import {
  allowWorkspacePort,
  createSnapshot,
  createWorkspace,
  deleteWorkspace,
  describeSnapshot,
  denyWorkspacePort,
  ensureDefaultWorkspace,
  getCurrentWorkspace,
  getWorkspaceRuntime,
  getWorkspace,
  listSnapshots,
  listWorkspacePorts,
  listWorkspaces,
  getSnapshotRetention,
  removeSnapshot,
  runSnapshotRetentionCleanup,
  restoreSnapshot,
  setSnapshotRetention,
  selectWorkspace,
  startWorkspace,
  setWorkspacePorts,
  stopWorkspace,
  updateWorkspaceStatus
} from './workspace-manager.mjs';
import {
  getGovernanceSummary,
  listAuditEvents,
  loadGovernancePolicy
} from './governance-manager.mjs';
import { countSnapshotsByWorkspace } from './snapshot-manager.mjs';
import {
  closeSession,
  heartbeatSession,
  listSessions,
  openSession,
  reconnectSession,
  validateAccessToken
} from './session-manager.mjs';
import { createWorkspaceSchedulerController } from './workspace-scheduler.mjs';
import {
  authenticateGateRequest,
  exchangeGateTokenForIdentity,
  isFounderGateIdentity
} from './gate-auth.mjs';

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function buildProxyHeaders(request, targetUrl) {
  const headers = { ...request.headers };
  delete headers.host;
  delete headers.connection;

  headers.host = targetUrl.host;
  headers['x-forwarded-host'] = request.headers.host || targetUrl.host;
  headers['x-forwarded-proto'] = 'http';

  const remoteAddress = request.socket.remoteAddress;
  if (remoteAddress) {
    const existing = request.headers['x-forwarded-for'];
    headers['x-forwarded-for'] = existing ? `${existing}, ${remoteAddress}` : remoteAddress;
  }

  return headers;
}

function copyProxyResponseHeaders(sourceHeaders, response, internalBaseUrl, publicBaseUrl) {
  for (const [key, value] of Object.entries(sourceHeaders)) {
    if (value === undefined || ['connection', 'transfer-encoding'].includes(key.toLowerCase())) {
      continue;
    }

    if (key.toLowerCase() === 'location') {
      const rewritten = rewriteLocationHeader(value, internalBaseUrl, publicBaseUrl);
      response.setHeader(key, rewritten);
      continue;
    }

    response.setHeader(key, value);
  }
}

function rewriteLocationHeader(value, internalBaseUrl, publicBaseUrl) {
  if (Array.isArray(value)) {
    return value.map(item => rewriteLocationHeader(item, internalBaseUrl, publicBaseUrl));
  }

  if (typeof value !== 'string' || !value.startsWith(internalBaseUrl)) {
    return value;
  }

  const internalUrl = new URL(value);
  return new URL(`${internalUrl.pathname}${internalUrl.search}${internalUrl.hash}`, publicBaseUrl).toString();
}

function writeGatewayError(response, code, error, detail) {
  writeJson(response, code, {
    error,
    detail
  });
}

function proxyHttpRequest(request, response, targetUrl, options = {}) {
  const upstream = http.request(targetUrl, {
    method: request.method,
    headers: buildProxyHeaders(request, targetUrl)
  });

  upstream.on('response', upstreamResponse => {
    response.statusCode = upstreamResponse.statusCode || 502;
    copyProxyResponseHeaders(
      upstreamResponse.headers,
      response,
      options.internalBaseUrl || `${targetUrl.protocol}//${targetUrl.host}`,
      options.publicBaseUrl || `${targetUrl.protocol}//${targetUrl.host}`
    );
    upstreamResponse.pipe(response);
  });

  upstream.on('error', error => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    writeGatewayError(
      response,
      502,
      options.unavailableError || 'upstream_unavailable',
      error instanceof Error ? error.message : String(error)
    );
  });

  request.pipe(upstream);
}

function writeUpgradeResponse(socket, statusCode, statusMessage, headers, head) {
  let payload = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach(item => {
        payload += `${key}: ${item}\r\n`;
      });
      continue;
    }

    payload += `${key}: ${value}\r\n`;
  }

  payload += '\r\n';
  socket.write(payload);

  if (head?.length) {
    socket.write(head);
  }
}

function proxyUpgradeRequest(request, socket, head, targetUrl, options = {}) {
  const upstream = http.request(targetUrl, {
    method: request.method,
    headers: {
      ...buildProxyHeaders(request, targetUrl),
      connection: request.headers.connection || 'Upgrade',
      upgrade: request.headers.upgrade
    }
  });

  upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    writeUpgradeResponse(
      socket,
      upstreamResponse.statusCode || 101,
      upstreamResponse.statusMessage || 'Switching Protocols',
      upstreamResponse.headers,
      upstreamHead
    );

    if (head?.length) {
      upstreamSocket.write(head);
    }

    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);

    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
  });

  upstream.on('response', upstreamResponse => {
    writeUpgradeResponse(
      socket,
      upstreamResponse.statusCode || 502,
      upstreamResponse.statusMessage || 'Bad Gateway',
      upstreamResponse.headers,
      Buffer.alloc(0)
    );
    upstreamResponse.resume();
    socket.end();
  });

  upstream.on('error', error => {
    writeUpgradeResponse(
      socket,
      502,
      'Bad Gateway',
      { 'content-type': 'application/json; charset=utf-8' },
      Buffer.from(
        JSON.stringify({
          error: options.unavailableError || 'upstream_unavailable',
          detail: error instanceof Error ? error.message : String(error)
        })
      )
    );
    socket.end();
  });

  upstream.end();
}

function createTargetUrl(baseUrl, pathname, search = '') {
  return new URL(`${pathname}${search}`, baseUrl);
}

async function checkUrl(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return {
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('error', reject);
    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(payload && typeof payload === 'object' ? payload : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
  });
}

function writeWorkspaceError(response, error) {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = message.includes('not registered') ? 404 : 400;
  writeJson(response, statusCode, {
    ok: false,
    error: 'workspace_request_failed',
    detail: message
  });
}

function extractBearerToken(request) {
  const authHeader = String(request.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const sessionHeader = String(request.headers['x-skyequanta-session-token'] || '').trim();
  if (sessionHeader) {
    return sessionHeader;
  }

  return null;
}

function extractTenantId(request) {
  const tenantHeader = String(request.headers['x-skyequanta-tenant-id'] || '').trim().toLowerCase();
  return tenantHeader || 'local';
}

function hasLocalAdminToken(config, request) {
  const configuredAdminToken = String(config?.auth?.adminToken || '').trim();
  const token = extractBearerToken(request);
  if (!configuredAdminToken || !token) {
    return false;
  }

  return token === configuredAdminToken;
}

function writeUnauthorized(response, detail) {
  writeJson(response, 401, {
    ok: false,
    error: 'unauthorized',
    detail
  });
}

function writeForbidden(response, detail) {
  writeJson(response, 403, {
    ok: false,
    error: 'forbidden',
    detail
  });
}

async function resolveAdminAccess(config, request) {
  if (hasLocalAdminToken(config, request)) {
    return {
      ok: true,
      mode: 'local-admin',
      identity: null,
      tenantId: 'founder-gateway'
    };
  }

  const gateAuth = await authenticateGateRequest(config, request);
  if (gateAuth.ok && isFounderGateIdentity(gateAuth.identity)) {
    return {
      ok: true,
      mode: 'founder-gateway',
      identity: gateAuth.identity,
      tenantId: gateAuth.identity.tenantId
    };
  }

  return {
    ok: false,
    mode: null,
    identity: null,
    tenantId: null,
    reason: gateAuth.reason === 'missing_gate_credentials'
      ? 'missing admin token or founder gateway session'
      : gateAuth.reason || 'missing admin token or founder gateway session'
  };
}

async function assertAdminAccess(config, request, response, detail) {
  const adminAccess = await resolveAdminAccess(config, request);
  if (!adminAccess.ok) {
    writeUnauthorized(response, detail);
    return null;
  }

  return adminAccess;
}

function buildLocalSessionAccess(session) {
  return {
    mode: 'session',
    session,
    gateIdentity: null,
    tenantId: session.tenantId
  };
}

function buildGateSessionAccess(identity) {
  return {
    mode: 'gate',
    session: null,
    gateIdentity: identity,
    tenantId: identity.tenantId
  };
}

async function requireSession(config, request, constraints = {}) {
  const accessToken = extractBearerToken(request);
  const tenantId = constraints.tenantId || extractTenantId(request);
  const workspaceId = constraints.workspaceId || null;
  const session = validateAccessToken(config, accessToken, {
    tenantId,
    workspaceId
  });

  if (session) {
    return buildLocalSessionAccess(session);
  }

  const gateAuth = await authenticateGateRequest(config, request);
  if (!gateAuth.ok || !gateAuth.identity) {
    return null;
  }

  const expectedTenantId = String(tenantId || '').trim().toLowerCase() || null;
  if (expectedTenantId && gateAuth.identity.tenantId !== expectedTenantId && !isFounderGateIdentity(gateAuth.identity)) {
    return null;
  }

  return buildGateSessionAccess(gateAuth.identity);
}

function getAuthActorId(auth) {
  if (auth.mode === 'admin') {
    return auth.gateIdentity?.appId || 'admin';
  }

  if (auth.mode === 'gate') {
    return auth.gateIdentity?.appId || auth.gateIdentity?.sessionId || 'gate-session';
  }

  return auth.session?.clientName || auth.session?.id || 'session-client';
}

async function requireAdminOrSession(config, request, constraints = {}) {
  const adminAccess = await resolveAdminAccess(config, request);
  if (adminAccess.ok) {
    return {
      ok: true,
      mode: 'admin',
      session: null,
      gateIdentity: adminAccess.identity,
      tenantId: constraints.tenantId || extractTenantId(request)
    };
  }

  const sessionAccess = await requireSession(config, request, constraints);
  if (!sessionAccess) {
    return {
      ok: false,
      reason: 'missing or invalid gate or workspace session token'
    };
  }

  return {
    ok: true,
    ...sessionAccess
  };
}

function parseForwardedPort(pathname) {
  const match = pathname.match(/^\/p\/(\d+)(?:\/(.*))?$/);
  if (!match) {
    return null;
  }

  const port = Number.parseInt(match[1], 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  const remainder = `/${match[2] || ''}`.replace(/\/+/g, '/');
  return {
    port,
    pathname: remainder === '/' ? '/' : remainder.replace(/\/$/, '') || '/'
  };
}

function resolveForwardedPortBase(workspace, port, defaultHost) {
  const configuredHost = String(workspace?.metadata?.forwardedHost || '').trim();
  if (!configuredHost) {
    return `http://${defaultHost}:${port}`;
  }

  if (configuredHost.startsWith('http://') || configuredHost.startsWith('https://')) {
    const url = new URL(configuredHost);
    url.port = String(port);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  return `http://${configuredHost}:${port}`;
}

function normalizePathPrefix(prefix) {
  const normalized = String(prefix || '/').trim();
  if (!normalized || normalized === '/') {
    return '/';
  }

  const withLeading = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeading.replace(/\/+$/, '');
}

function joinPath(base, suffix) {
  const normalizedBase = normalizePathPrefix(base);
  const normalizedSuffix = String(suffix || '').startsWith('/') ? suffix : `/${suffix || ''}`;
  if (normalizedBase === '/') {
    return normalizedSuffix;
  }

  return `${normalizedBase}${normalizedSuffix}`;
}

export function createBridgeServer(config) {
  const defaultWorkspaceState = ensureDefaultWorkspace(config);
  const internalUrls = getInternalUrls(config);
  const publicUrls = getPublicUrls(config);
  const runtimeContract = getRuntimeContract(config);
  const scheduler = createWorkspaceSchedulerController(config);
  scheduler.start();

  const parseWorkspacePrefix = pathname => {
    const match = pathname.match(/^\/w\/([a-z0-9-]+)(?:\/|$)(.*)$/i);
    if (!match) {
      return null;
    }

    const workspaceId = match[1];
    const remainder = `/${match[2] || ''}`.replace(/\/+/g, '/');
    return {
      workspaceId,
      pathname: remainder === '/' ? '/' : remainder.replace(/\/$/, '') || '/'
    };
  };

  const resolveWorkspace = workspaceId => {
    const workspace = getWorkspace(config, workspaceId);
    return workspace || null;
  };

  const getWorkspaceEndpoints = workspace => ({
    ide: workspace?.routes?.ideBaseUrl || internalUrls.ide,
    agentBackend: workspace?.routes?.agentBaseUrl || internalUrls.agentBackend,
    gate: workspace?.routes?.gateBaseUrl || internalUrls.gate,
    bridgePathPrefix: workspace?.routes?.bridgePathPrefix || `/w/${workspace?.id || defaultWorkspaceState.workspace.id}`
  });

  const resolveForwardedPortTarget = (requestUrl, workspace) => {
    const parsed = parseForwardedPort(requestUrl.pathname);
    if (!parsed) {
      return null;
    }

    const allowedPorts = Array.isArray(workspace?.metadata?.forwardedPorts) ? workspace.metadata.forwardedPorts : [];
    if (!allowedPorts.includes(parsed.port)) {
      return {
        denied: true,
        port: parsed.port
      };
    }

    const endpoints = getWorkspaceEndpoints(workspace);
    const targetBase = resolveForwardedPortBase(workspace, parsed.port, config.host);
    const publicBasePath = joinPath(endpoints.bridgePathPrefix, `/p/${parsed.port}`);
    const publicBaseUrl = new URL(publicBasePath, publicUrls.ide).toString();

    return {
      targetUrl: createTargetUrl(targetBase, parsed.pathname, requestUrl.search),
      internalBaseUrl: targetBase,
      publicBaseUrl,
      unavailableError: 'forwarded_port_unavailable',
      port: parsed.port
    };
  };

  const getRuntimeContractForWorkspace = workspace => {
    const basePath = workspace?.routes?.bridgePathPrefix || '/';
    const normalizedBasePath = basePath === '/' ? '' : basePath;
    const contract = {
      ...runtimeContract,
      workspace: {
        id: workspace?.id || defaultWorkspaceState.workspace.id,
        name: workspace?.name || defaultWorkspaceState.workspace.name,
        pathPrefix: normalizedBasePath || '/'
      },
      routes: {
        ...runtimeContract.routes,
        ide: `${normalizedBasePath}/`,
        forwardedPort: `${normalizedBasePath}/p/:port`,
        health: `${normalizedBasePath}/health`,
        status: `${normalizedBasePath}/api/status`,
        runtimeContract: `${normalizedBasePath}/api/runtime-contract`,
        agentApi: `${normalizedBasePath}/api/agent`,
        agentApiDocs: `${normalizedBasePath}/api/agent/docs`,
        gateApi: `${normalizedBasePath}/api/gate`,
        gateModels: `${normalizedBasePath}/api/gate/v1/models`,
        gateChatCompletions: `${normalizedBasePath}/api/gate/v1/chat/completions`
      }
    };

    return contract;
  };

  const resolveTarget = (requestUrl, workspace) => {
    const endpoints = getWorkspaceEndpoints(workspace);

    if (requestUrl.pathname.startsWith('/api/gate')) {
      if (!endpoints.gate) {
        return null;
      }

      const targetPath = requestUrl.pathname.replace('/api/gate', '') || '/';
      return {
        targetUrl: createTargetUrl(endpoints.gate, targetPath, requestUrl.search),
        internalBaseUrl: endpoints.gate,
        publicBaseUrl: publicUrls.gateApi,
        unavailableError: 'gate_unavailable'
      };
    }

    if (requestUrl.pathname.startsWith('/api/agent')) {
      const targetPath = requestUrl.pathname.replace('/api/agent', '') || '/';
      return {
        targetUrl: createTargetUrl(endpoints.agentBackend, targetPath, requestUrl.search),
        internalBaseUrl: endpoints.agentBackend,
        publicBaseUrl: publicUrls.agentBackend,
        unavailableError: 'agent_backend_unavailable'
      };
    }

    const forwardedTarget = resolveForwardedPortTarget(requestUrl, workspace);
    if (forwardedTarget?.denied) {
      return {
        denied: true,
        unavailableError: 'forwarded_port_forbidden',
        port: forwardedTarget.port
      };
    }

    if (forwardedTarget) {
      return forwardedTarget;
    }

    return {
      targetUrl: createTargetUrl(endpoints.ide, requestUrl.pathname, requestUrl.search),
      internalBaseUrl: endpoints.ide,
      publicBaseUrl: publicUrls.ide,
      unavailableError: 'ide_unavailable'
    };
  };

  const writeStatus = async (response, workspace) => {
    const endpoints = getWorkspaceEndpoints(workspace);
    const workspaceContract = getRuntimeContractForWorkspace(workspace);
    const [backend, ide, gate] = await Promise.all([
      checkUrl(`${endpoints.agentBackend}/health`),
      checkUrl(endpoints.ide),
      endpoints.gate ? checkUrl(`${endpoints.gate}/v1/health`) : Promise.resolve({ ok: false, status: 0, detail: 'not_configured' })
    ]);

    writeJson(response, 200, {
      productName: config.productName,
      companyName: config.companyName,
      aiDisplayName: config.aiDisplayName,
      workspace: {
        id: workspace?.id || defaultWorkspaceState.workspace.id,
        name: workspace?.name || defaultWorkspaceState.workspace.name,
        pathPrefix: workspaceContract.workspace.pathPrefix,
        forwardedPorts: Array.isArray(workspace?.metadata?.forwardedPorts) ? workspace.metadata.forwardedPorts : [],
        forwardedHost: workspace?.metadata?.forwardedHost || null
      },
      urls: {
        web: publicUrls.ide,
        status: publicUrls.status,
        runtimeContract: publicUrls.runtimeContract,
        agentApi: publicUrls.agentBackend,
        agentApiDocs: publicUrls.agentApiDocs,
        gateApi: publicUrls.gateApi
      },
      runtimeContract: workspaceContract,
      services: {
        agentBackend: backend,
        ide,
        gate
      }
    });
  };

  const server = http.createServer(async (request, response) => {
    const incomingUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    let cachedAdminAccess = null;
    const getAdminAccess = async () => {
      if (!cachedAdminAccess) {
        cachedAdminAccess = resolveAdminAccess(config, request);
      }
      return cachedAdminAccess;
    };
    const workspacePrefix = parseWorkspacePrefix(incomingUrl.pathname);
    const workspace = workspacePrefix ? resolveWorkspace(workspacePrefix.workspaceId) : defaultWorkspaceState.workspace;

    if (workspacePrefix && !workspace) {
      writeGatewayError(response, 404, 'workspace_not_found', `Workspace '${workspacePrefix.workspaceId}' is not registered.`);
      return;
    }

    if (workspacePrefix) {
      const tenantId = String(workspace?.metadata?.tenantId || extractTenantId(request)).trim().toLowerCase() || 'local';
      const session = await requireSession(config, request, {
        workspaceId: workspace.id,
        tenantId
      });
      if (!session) {
        writeUnauthorized(response, `A valid session token is required for workspace route '${workspace.id}'.`);
        return;
      }
    }

    const requestUrl = new URL(incomingUrl.toString());
    if (workspacePrefix) {
      requestUrl.pathname = workspacePrefix.pathname;
    }

    if (requestUrl.pathname === '/health') {
      writeJson(response, 200, { status: 'ok' });
      return;
    }

    if (requestUrl.pathname === '/api/runtime-contract') {
      writeJson(response, 200, getRuntimeContractForWorkspace(workspace));
      return;
    }

    if (requestUrl.pathname === '/api/sessions' && request.method === 'GET') {
      const adminAccess = await getAdminAccess();
      if (!adminAccess.ok) {
        writeUnauthorized(response, 'Admin token is required to list sessions.');
        return;
      }

      const tenantId = String(requestUrl.searchParams.get('tenantId') || '').trim().toLowerCase() || null;
      const sessions = listSessions(config, tenantId);
      writeJson(response, 200, {
        ok: true,
        count: sessions.length,
        sessions: sessions.map(session => ({
          id: session.id,
          tenantId: session.tenantId,
          workspaceId: session.workspaceId,
          clientName: session.clientName,
          authSource: session.authSource,
          gateSessionId: session.gateSessionId,
          gateAppId: session.gateAppId,
          gateOrgId: session.gateOrgId,
          gateAuthMode: session.gateAuthMode,
          founderGateway: session.founderGateway,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt
        }))
      });
      return;
    }

    if (requestUrl.pathname === '/api/sessions/open' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request);
        const workspaceId = String(body.workspaceId || '').trim();
        if (!workspaceId) {
          throw new Error('workspaceId is required to open a session.');
        }

        const targetWorkspace = getWorkspace(config, workspaceId);
        if (!targetWorkspace) {
          writeJson(response, 404, { ok: false, error: 'workspace_not_found', workspaceId });
          return;
        }

        const rawGateToken = String(body.token || body.os_key || body['0sKey'] || '').trim();
        const gateGrant = rawGateToken
          ? await exchangeGateTokenForIdentity(config, rawGateToken)
          : (() => null)();
        const requestGateAuth = gateGrant
          ? { ok: true, identity: gateGrant.identity, sessionToken: gateGrant.sessionToken }
          : await authenticateGateRequest(config, request);
        const adminAccess = await getAdminAccess();
        const gateIdentity = requestGateAuth.ok ? requestGateAuth.identity : null;

        if (!gateIdentity) {
          writeUnauthorized(response, 'A gate session, 0sKey, or founder gateway credential is required to open workspace sessions.');
          return;
        }

        const workspaceTenant = String(targetWorkspace.metadata?.tenantId || 'local').trim().toLowerCase() || 'local';
        const tenantId = String(body.tenantId || gateIdentity.tenantId || workspaceTenant).trim().toLowerCase() || 'local';
        if (!adminAccess.ok && tenantId !== workspaceTenant && !isFounderGateIdentity(gateIdentity)) {
          writeForbidden(response, `Tenant '${tenantId}' is not allowed for workspace '${workspaceId}'.`);
          return;
        }

        const session = openSession(config, {
          workspaceId,
          tenantId,
          clientName: body.clientName || gateIdentity.appId,
          authSource: 'gate-derived-session',
          gateSessionId: gateIdentity.sessionId,
          gateAppId: gateIdentity.appId,
          gateOrgId: gateIdentity.orgId,
          gateAuthMode: gateIdentity.authMode,
          founderGateway: gateIdentity.founderGateway,
          gateExpiresAt: gateIdentity.expiresAt
        });

        writeJson(response, 201, {
          ok: true,
          action: 'session_open',
          gate: {
            sessionToken: requestGateAuth.sessionToken,
            identity: gateIdentity
          },
          session: {
            id: session.id,
            tenantId: session.tenantId,
            workspaceId: session.workspaceId,
            accessToken: session.accessToken,
            reconnectToken: session.reconnectToken,
            authSource: session.authSource,
            gateSessionId: session.gateSessionId,
            gateAppId: session.gateAppId,
            gateOrgId: session.gateOrgId,
            gateAuthMode: session.gateAuthMode,
            founderGateway: session.founderGateway,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt
          }
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname === '/api/sessions/reconnect' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request);
        const session = reconnectSession(config, body.sessionId, body.reconnectToken);
        writeJson(response, 200, {
          ok: true,
          action: 'session_reconnect',
          session: {
            id: session.id,
            tenantId: session.tenantId,
            workspaceId: session.workspaceId,
            accessToken: session.accessToken,
            reconnectToken: session.reconnectToken,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt
          }
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname.startsWith('/api/sessions/') && request.method === 'POST') {
      const segments = requestUrl.pathname.split('/').filter(Boolean);
      const sessionId = segments[2] || null;
      const action = segments[3] || null;

      if (!sessionId || !action) {
        writeJson(response, 400, { ok: false, error: 'session_request_invalid' });
        return;
      }

      if (action === 'heartbeat') {
        try {
          const accessToken = extractBearerToken(request);
          const session = heartbeatSession(config, sessionId, accessToken);
          writeJson(response, 200, {
            ok: true,
            action: 'session_heartbeat',
            session: {
              id: session.id,
              tenantId: session.tenantId,
              workspaceId: session.workspaceId,
              lastSeenAt: session.lastSeenAt,
              expiresAt: session.expiresAt
            }
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (action === 'close') {
        try {
          const admin = (await getAdminAccess()).ok;
          const accessToken = admin ? null : extractBearerToken(request);
          const result = closeSession(config, sessionId, accessToken);
          writeJson(response, 200, {
            ok: true,
            action: 'session_close',
            ...result
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      writeJson(response, 405, { ok: false, error: 'session_method_not_allowed' });
      return;
    }

    if (requestUrl.pathname === '/api/workspaces' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to list workspaces.');
        return;
      }

      const state = listWorkspaces(config);
      writeJson(response, 200, { ok: true, ...state });
      return;
    }

    if (requestUrl.pathname === '/api/governance/policy' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read governance policy.');
        return;
      }

      writeJson(response, 200, {
        ok: true,
        policy: loadGovernancePolicy(config)
      });
      return;
    }

    if (requestUrl.pathname === '/api/governance/usage' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read governance usage.');
        return;
      }

      const workspaceState = listWorkspaces(config);
      const sessions = listSessions(config);
      const snapshotCountByWorkspace = countSnapshotsByWorkspace(config);
      writeJson(response, 200, {
        ok: true,
        ...getGovernanceSummary(config, {
          workspaceCount: workspaceState.count,
          sessionCount: sessions.length,
          snapshotCountByWorkspace
        })
      });
      return;
    }

    if (requestUrl.pathname === '/api/audit' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read audit trail.');
        return;
      }

      const limit = Number.parseInt(String(requestUrl.searchParams.get('limit') || '100'), 10) || 100;
      const offset = Number.parseInt(String(requestUrl.searchParams.get('offset') || '0'), 10) || 0;
      const workspaceId = String(requestUrl.searchParams.get('workspaceId') || '').trim() || null;
      const tenantId = String(requestUrl.searchParams.get('tenantId') || '').trim().toLowerCase() || null;
      const startAt = String(requestUrl.searchParams.get('startAt') || '').trim() || null;
      const endAt = String(requestUrl.searchParams.get('endAt') || '').trim() || null;
      const result = listAuditEvents(config, {
        limit,
        offset,
        workspaceId,
        tenantId,
        startAt,
        endAt
      });

      writeJson(response, 200, {
        ok: true,
        ...result,
        count: result.events.length
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read scheduler state.');
        return;
      }

      writeJson(response, 200, {
        ok: true,
        ...scheduler.getStatus()
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/history' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read scheduler history.');
        return;
      }

      const limit = Number.parseInt(String(requestUrl.searchParams.get('limit') || '100'), 10) || 100;
      const offset = Number.parseInt(String(requestUrl.searchParams.get('offset') || '0'), 10) || 0;
      const trigger = String(requestUrl.searchParams.get('trigger') || '').trim() || null;
      const startAt = String(requestUrl.searchParams.get('startAt') || '').trim() || null;
      const endAt = String(requestUrl.searchParams.get('endAt') || '').trim() || null;
      const history = scheduler.getHistory({
        limit,
        offset,
        trigger,
        startAt,
        endAt
      });

      writeJson(response, 200, {
        ok: true,
        ...history,
        count: history.runs.length
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/trends' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read scheduler trends.');
        return;
      }

      const bucket = String(requestUrl.searchParams.get('bucket') || 'day').trim() || 'day';
      const limit = Number.parseInt(String(requestUrl.searchParams.get('limit') || '120'), 10) || 120;
      const offset = Number.parseInt(String(requestUrl.searchParams.get('offset') || '0'), 10) || 0;
      const trigger = String(requestUrl.searchParams.get('trigger') || '').trim() || null;
      const startAt = String(requestUrl.searchParams.get('startAt') || '').trim() || null;
      const endAt = String(requestUrl.searchParams.get('endAt') || '').trim() || null;
      const trends = scheduler.getTrends({
        bucket,
        limit,
        offset,
        trigger,
        startAt,
        endAt
      });

      writeJson(response, 200, {
        ok: true,
        ...trends,
        count: trends.points.length
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/trends/compact' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read scheduler trend cards.');
        return;
      }

      const bucket = String(requestUrl.searchParams.get('bucket') || 'day').trim() || 'day';
      const trigger = String(requestUrl.searchParams.get('trigger') || '').trim() || null;
      const startAt = String(requestUrl.searchParams.get('startAt') || '').trim() || null;
      const endAt = String(requestUrl.searchParams.get('endAt') || '').trim() || null;
      const compact = scheduler.getTrendsCompact({
        bucket,
        trigger,
        startAt,
        endAt
      });

      writeJson(response, 200, {
        ok: true,
        ...compact
      });
      return;
    }

    if (requestUrl.pathname === '/api/control-plane/summary' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read control plane summary.');
        return;
      }

      const bucket = String(requestUrl.searchParams.get('bucket') || 'day').trim() || 'day';
      const trigger = String(requestUrl.searchParams.get('trigger') || '').trim() || null;
      const startAt = String(requestUrl.searchParams.get('startAt') || '').trim() || null;
      const endAt = String(requestUrl.searchParams.get('endAt') || '').trim() || null;

      const schedulerStatus = scheduler.getStatus();
      const schedulerTrendCard = scheduler.getTrendsCompact({
        bucket,
        trigger,
        startAt,
        endAt
      });
      const workspaceState = listWorkspaces(config);
      const sessions = listSessions(config);
      const governance = getGovernanceSummary(config);

      writeJson(response, 200, {
        ok: true,
        scheduler: {
          controller: schedulerStatus.controller,
          state: schedulerStatus.state,
          policy: schedulerStatus.policy,
          trendCard: schedulerTrendCard
        },
        workspaces: {
          currentWorkspaceId: workspaceState.currentWorkspaceId,
          total: workspaceState.workspaces.length,
          running: workspaceState.workspaces.filter(item => item.status === 'running').length,
          ready: workspaceState.workspaces.filter(item => item.status === 'ready').length,
          stopped: workspaceState.workspaces.filter(item => item.status === 'stopped').length,
          error: workspaceState.workspaces.filter(item => item.status === 'error').length
        },
        sessions: {
          open: sessions.total
        },
        governance
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/start' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to start scheduler.');
        return;
      }

      writeJson(response, 200, {
        ok: true,
        action: 'scheduler_start',
        ...scheduler.start()
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/stop' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to stop scheduler.');
        return;
      }

      writeJson(response, 200, {
        ok: true,
        action: 'scheduler_stop',
        ...scheduler.stop()
      });
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/policy' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to update scheduler policy.');
        return;
      }

      try {
        const body = await readJsonBody(request);
        const result = scheduler.updatePolicy({
          enabled: body.enabled,
          intervalMs: body.intervalMs,
          healthTimeoutMs: body.healthTimeoutMs,
          maxRestartsPerRun: body.maxRestartsPerRun,
          restartCooldownMs: body.restartCooldownMs,
          cleanupExpiredSessions: body.cleanupExpiredSessions,
          retentionCleanupEnabled: body.retentionCleanupEnabled,
          retentionCleanupEveryRuns: body.retentionCleanupEveryRuns,
          historyMaxEntries: body.historyMaxEntries
        });

        writeJson(response, 200, {
          ok: true,
          action: 'scheduler_policy_update',
          ...result
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname === '/api/scheduler/run' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to run scheduler sweep.');
        return;
      }

      try {
        const body = await readJsonBody(request);
        const result = await scheduler.runNow({
          trigger: 'admin_api',
          workspaceId: body.workspaceId || null
        });

        writeJson(response, 200, {
          ok: true,
          action: 'scheduler_run',
          ...result
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname === '/api/snapshots/retention' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read snapshot retention policy.');
        return;
      }

      const workspaceId = String(requestUrl.searchParams.get('workspaceId') || '').trim() || null;
      try {
        const result = getSnapshotRetention(config, workspaceId);
        writeJson(response, 200, {
          ok: true,
          ...result
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname === '/api/snapshots/retention' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to update snapshot retention policy.');
        return;
      }

      try {
        const body = await readJsonBody(request);
        const policy = setSnapshotRetention(config, {
          scope: body.scope,
          mode: body.mode,
          tenantId: body.tenantId,
          workspaceId: body.workspaceId,
          maxSnapshots: body.maxSnapshots,
          maxAgeDays: body.maxAgeDays
        });

        writeJson(response, 200, {
          ok: true,
          action: 'snapshot_retention_update',
          policy
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname === '/api/snapshots/retention/cleanup' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to run retention cleanup.');
        return;
      }

      try {
        const body = await readJsonBody(request);
        const result = runSnapshotRetentionCleanup(config, body.workspaceId || null, {
          actorId: 'admin-retention-cleanup',
          protectSnapshotId: body.protectSnapshotId || null
        });
        writeJson(response, 200, {
          ok: true,
          action: 'snapshot_retention_cleanup',
          ...result
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname === '/api/workspaces/current' && request.method === 'GET') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to read current workspace.');
        return;
      }

      const currentWorkspace = getCurrentWorkspace(config);
      writeJson(response, 200, {
        ok: true,
        workspace: currentWorkspace
      });
      return;
    }

    if (requestUrl.pathname === '/api/workspaces' && request.method === 'POST') {
      if (!(await getAdminAccess()).ok) {
        writeUnauthorized(response, 'Admin token is required to create workspaces.');
        return;
      }

      try {
        const body = await readJsonBody(request);
        const workspaceId = String(body.id || '').trim();
        const workspaceName = String(body.name || workspaceId || '').trim();
        if (!workspaceId) {
          throw new Error('Workspace id is required.');
        }

        const result = createWorkspace(config, workspaceId, {
          name: workspaceName || workspaceId,
          ideBaseUrl: body.ideBaseUrl,
          agentBaseUrl: body.agentBaseUrl,
          gateBaseUrl: body.gateBaseUrl,
          tenantId: body.tenantId || extractTenantId(request),
          source: 'bridge'
        });

        writeJson(response, result.created ? 201 : 200, {
          ok: true,
          created: result.created,
          workspace: result.workspace
        });
      } catch (error) {
        writeWorkspaceError(response, error);
      }
      return;
    }

    if (requestUrl.pathname.startsWith('/api/workspaces/')) {
      const segments = requestUrl.pathname.split('/').filter(Boolean);
      const workspaceId = segments[2] || null;
      const action = segments[3] || null;
      const child = segments[4] || null;
      const childAction = segments[5] || null;

      if (!workspaceId) {
        writeJson(response, 400, { ok: false, error: 'workspace_id_required' });
        return;
      }

      const targetWorkspace = getWorkspace(config, workspaceId);
      if (!targetWorkspace) {
        writeJson(response, 404, { ok: false, error: 'workspace_not_found', workspaceId });
        return;
      }

      const auth = await requireAdminOrSession(config, request, {
        tenantId: targetWorkspace?.metadata?.tenantId || extractTenantId(request),
        workspaceId
      });
      if (!auth.ok) {
        writeUnauthorized(response, auth.reason || 'Access denied for workspace operation.');
        return;
      }

      const workspaceTenant = String(targetWorkspace?.metadata?.tenantId || 'local').trim().toLowerCase();
      if (auth.mode !== 'admin' && auth.tenantId !== workspaceTenant) {
        writeForbidden(response, `Tenant '${auth.tenantId}' is not allowed for workspace '${workspaceId}'.`);
        return;
      }

      if (request.method === 'GET' && !action) {
        const selectedWorkspace = targetWorkspace;
        writeJson(response, 200, { ok: true, workspace: selectedWorkspace });
        return;
      }

      if (request.method === 'DELETE' && !action) {
        if (auth.mode !== 'admin') {
          writeForbidden(response, `Only admin is allowed to delete workspace '${workspaceId}'.`);
          return;
        }

        try {
          const result = await deleteWorkspace(config, workspaceId, {
            deletedBy: 'bridge-admin'
          });
          writeJson(response, 200, {
            ok: true,
            action: 'workspace_delete',
            ...result
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'select') {
        try {
          const result = selectWorkspace(config, workspaceId);
          writeJson(response, 200, { ok: true, selected: true, workspace: result.workspace });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'start') {
        try {
          const result = await startWorkspace(config, workspaceId, 'bridge_start');
          writeJson(response, 200, { ok: true, action: 'start', workspace: result.workspace });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'stop') {
        try {
          const result = await stopWorkspace(config, workspaceId, 'bridge_stop');
          writeJson(response, 200, { ok: true, action: 'stop', workspace: result.workspace });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'GET' && action === 'runtime') {
        try {
          const runtime = getWorkspaceRuntime(config, workspaceId);
          writeJson(response, 200, {
            ok: true,
            action: 'runtime',
            workspace: runtime.workspace,
            runtime: runtime.runtime,
            state: runtime.state
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'status') {
        try {
          const body = await readJsonBody(request);
          const nextStatus = String(body.status || '').trim().toLowerCase();
          const reason = String(body.reason || 'bridge_status_update').trim() || 'bridge_status_update';
          const result = updateWorkspaceStatus(config, workspaceId, nextStatus, reason);
          writeJson(response, 200, { ok: true, action: 'status', workspace: result.workspace });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'GET' && action === 'ports') {
        try {
          const state = listWorkspacePorts(config, workspaceId);
          writeJson(response, 200, {
            ok: true,
            action: 'ports',
            workspace: state.workspace,
            forwardedHost: state.forwardedHost,
            forwardedPorts: state.forwardedPorts
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (action === 'snapshots' && request.method === 'GET' && !child) {
        try {
          const state = listSnapshots(config, workspaceId);
          writeJson(response, 200, {
            ok: true,
            action: 'snapshots_list',
            workspace: state.workspace,
            count: state.snapshots.length,
            snapshots: state.snapshots
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'GET' && action === 'snapshot-retention') {
        try {
          const result = getSnapshotRetention(config, workspaceId);
          writeJson(response, 200, {
            ok: true,
            action: 'snapshot_retention_get',
            ...result
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'snapshot-retention') {
        if (auth.mode !== 'admin') {
          writeForbidden(response, `Only admin is allowed to update snapshot retention for workspace '${workspaceId}'.`);
          return;
        }

        try {
          const body = await readJsonBody(request);
          const policy = setSnapshotRetention(config, {
            scope: 'workspace',
            mode: body.mode || 'set',
            workspaceId,
            maxSnapshots: body.maxSnapshots,
            maxAgeDays: body.maxAgeDays
          });
          writeJson(response, 200, {
            ok: true,
            action: 'snapshot_retention_set',
            policy
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'snapshot-retention-cleanup') {
        try {
          const body = await readJsonBody(request);
          const result = runSnapshotRetentionCleanup(config, workspaceId, {
            actorId: auth.mode === 'admin' ? 'admin-retention-cleanup' : getAuthActorId(auth),
            protectSnapshotId: body.protectSnapshotId || null
          });
          writeJson(response, 200, {
            ok: true,
            action: 'snapshot_retention_cleanup',
            ...result
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (action === 'snapshots' && request.method === 'POST' && !child) {
        try {
          const body = await readJsonBody(request);
          const result = await createSnapshot(config, workspaceId, {
            label: body.label,
            restartAfter: body.restartAfter !== false,
            createdBy: getAuthActorId(auth)
          });
          writeJson(response, 201, {
            ok: true,
            action: 'snapshot_create',
            workspace: result.workspace,
            snapshot: result.snapshot
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (action === 'snapshots' && child && request.method === 'GET' && !childAction) {
        try {
          const result = describeSnapshot(config, workspaceId, child);
          writeJson(response, 200, {
            ok: true,
            action: 'snapshot_describe',
            workspace: result.workspace,
            snapshot: result.snapshot
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (action === 'snapshots' && child && childAction === 'restore' && request.method === 'POST') {
        try {
          const body = await readJsonBody(request);
          const result = await restoreSnapshot(config, workspaceId, child, {
            restartAfter: body.restartAfter !== false,
            restoredBy: getAuthActorId(auth)
          });
          writeJson(response, 200, {
            ok: true,
            action: 'snapshot_restore',
            workspace: result.workspace,
            snapshot: result.snapshot
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (action === 'snapshots' && child && request.method === 'DELETE' && !childAction) {
        try {
          const result = removeSnapshot(config, workspaceId, child);
          writeJson(response, 200, {
            ok: true,
            action: 'snapshot_delete',
            ...result
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'ports') {
        try {
          const body = await readJsonBody(request);
          const ports = Array.isArray(body.ports) ? body.ports : [];
          const result = setWorkspacePorts(config, workspaceId, ports, {
            forwardedHost: body.forwardedHost
          });
          writeJson(response, 200, {
            ok: true,
            action: 'ports_set',
            workspace: result.workspace
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'allow-port') {
        try {
          const body = await readJsonBody(request);
          const result = allowWorkspacePort(config, workspaceId, body.port, {
            forwardedHost: body.forwardedHost
          });
          writeJson(response, 200, {
            ok: true,
            action: 'allow-port',
            workspace: result.workspace
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      if (request.method === 'POST' && action === 'deny-port') {
        try {
          const body = await readJsonBody(request);
          const result = denyWorkspacePort(config, workspaceId, body.port);
          writeJson(response, 200, {
            ok: true,
            action: 'deny-port',
            workspace: result.workspace
          });
        } catch (error) {
          writeWorkspaceError(response, error);
        }
        return;
      }

      writeJson(response, 405, { ok: false, error: 'workspace_method_not_allowed' });
      return;
    }

    if (requestUrl.pathname === '/api/status') {
      await writeStatus(response, workspace);
      return;
    }

    const target = resolveTarget(requestUrl, workspace);
    if (!target) {
      writeGatewayError(response, 503, 'gate_unavailable', 'SKYEQUANTA_GATE_URL is not configured for this bridge.');
      return;
    }

    if (target.denied) {
      writeGatewayError(response, 403, 'forwarded_port_forbidden', `Workspace '${workspace.id}' has not allowed this forwarded port.`);
      return;
    }

    proxyHttpRequest(request, response, target.targetUrl, target);
  });

  server.on('upgrade', async (request, socket, head) => {
    const incomingUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const workspacePrefix = parseWorkspacePrefix(incomingUrl.pathname);
    const workspace = workspacePrefix ? resolveWorkspace(workspacePrefix.workspaceId) : defaultWorkspaceState.workspace;

    if (workspacePrefix && !workspace) {
      writeUpgradeResponse(socket, 404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('workspace not found'));
      socket.end();
      return;
    }

    if (workspacePrefix) {
      const tenantId = String(workspace?.metadata?.tenantId || extractTenantId(request)).trim().toLowerCase() || 'local';
      const session = await requireSession(config, request, {
        workspaceId: workspace.id,
        tenantId
      });
      if (!session) {
        writeUpgradeResponse(socket, 401, 'Unauthorized', { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('missing workspace session token'));
        socket.end();
        return;
      }
    }

    const requestUrl = new URL(incomingUrl.toString());
    if (workspacePrefix) {
      requestUrl.pathname = workspacePrefix.pathname;
    }

    if (requestUrl.pathname === '/health' || requestUrl.pathname === '/api/status' || requestUrl.pathname === '/api/runtime-contract') {
      writeUpgradeResponse(socket, 404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('not found'));
      socket.end();
      return;
    }

    const target = resolveTarget(requestUrl, workspace);
    if (!target) {
      writeUpgradeResponse(socket, 503, 'Service Unavailable', { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('gate unavailable'));
      socket.end();
      return;
    }

    if (target.denied) {
      writeUpgradeResponse(socket, 403, 'Forbidden', { 'content-type': 'text/plain; charset=utf-8' }, Buffer.from('forwarded port forbidden'));
      socket.end();
      return;
    }

    proxyUpgradeRequest(request, socket, head, target.targetUrl, target);
  });

  server.on('close', () => {
    scheduler.stop();
  });

  return server;
}