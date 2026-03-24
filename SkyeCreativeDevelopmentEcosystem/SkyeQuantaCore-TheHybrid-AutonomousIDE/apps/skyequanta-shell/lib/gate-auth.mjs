function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildGateUrl(baseUrl, routePath) {
  const normalizedBase = normalizeUrl(baseUrl);
  if (!normalizedBase) {
    return null;
  }

  const base = new URL(normalizedBase);
  const normalizedRoute = String(routePath || '').trim() || '/';
  const trimmedBasePath = base.pathname.replace(/\/+$/, '');
  const baseHasV1 = trimmedBasePath.endsWith('/v1');
  const nextPath = baseHasV1 && normalizedRoute.startsWith('/v1/')
    ? normalizedRoute.slice(3)
    : normalizedRoute;

  return new URL(nextPath, `${base.toString().replace(/\/+$/, '')}/`).toString();
}

function readHeader(headers, names) {
  for (const name of names) {
    const value = typeof headers?.get === 'function'
      ? headers.get(name)
      : headers?.[name];
    const normalized = String(value || '').trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

export function extractBearerToken(source) {
  const headers = source?.headers || source;
  const authorization = readHeader(headers, ['authorization', 'Authorization']);
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return authorization.slice(7).trim();
}

export function extractFounderGatewayKey(source) {
  const headers = source?.headers || source;
  return readHeader(headers, [
    'x-founders-gateway-key',
    'X-Founders-Gateway-Key',
    'x-founder-gateway-key',
    'X-Founder-Gateway-Key',
    'x-founders-code',
    'X-Founders-Code'
  ]);
}

function buildGateAuthError(operation, responseBody, fallbackMessage) {
  const detail = String(
    responseBody?.detail
    || responseBody?.error
    || responseBody?.message
    || fallbackMessage
    || `${operation} failed.`
  ).trim();
  return new Error(`Gate ${operation} failed: ${detail}`);
}

async function parseJsonResponse(response, operation) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw buildGateAuthError(operation, payload, `HTTP ${response.status}`);
  }

  return payload;
}

function normalizeGateIdentity(sessionToken, payload) {
  const session = payload?.session;
  if (!payload?.ok || !session) {
    throw buildGateAuthError('identity lookup', payload, 'Gate did not return a session object.');
  }

  const authMode = String(session.auth_mode || '').trim() || 'unknown';
  const appId = String(session.app_id || '').trim() || 'unknown';
  const orgId = String(session.org_id || '').trim() || appId;
  const tenantId = orgId || appId || 'local';

  return {
    sessionToken,
    sessionId: String(session.id || '').trim() || null,
    appId,
    orgId,
    tenantId: String(tenantId).trim().toLowerCase() || 'local',
    authMode,
    founderGateway: authMode === 'founder-gateway',
    expiresAt: String(session.expires_at || '').trim() || null
  };
}

export async function loginGateSession(config, token) {
  const loginUrl = buildGateUrl(config?.gate?.url, '/v1/auth/login');
  const normalizedToken = String(token || '').trim();
  if (!loginUrl) {
    throw new Error('Gate URL is not configured.');
  }

  if (!normalizedToken) {
    throw new Error('A gate token or founder gateway key is required.');
  }

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ token: normalizedToken })
  });
  const payload = await parseJsonResponse(response, 'login');
  const sessionToken = String(payload?.session_token || '').trim();
  if (!sessionToken) {
    throw buildGateAuthError('login', payload, 'Gate login did not return a session token.');
  }

  return {
    sessionToken,
    authMode: String(payload?.auth_mode || '').trim() || 'unknown',
    expiresAt: String(payload?.expires_at || '').trim() || null
  };
}

export async function readGateSessionIdentity(config, sessionToken) {
  const meUrl = buildGateUrl(config?.gate?.url, '/v1/auth/me');
  const normalizedToken = String(sessionToken || '').trim();
  if (!meUrl) {
    throw new Error('Gate URL is not configured.');
  }

  if (!normalizedToken) {
    throw new Error('A gate session token is required.');
  }

  const response = await fetch(meUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${normalizedToken}`
    }
  });
  const payload = await parseJsonResponse(response, 'identity lookup');
  return normalizeGateIdentity(normalizedToken, payload);
}

export async function exchangeGateTokenForIdentity(config, token) {
  const login = await loginGateSession(config, token);
  const identity = await readGateSessionIdentity(config, login.sessionToken);
  return {
    sessionToken: login.sessionToken,
    identity: {
      ...identity,
      authMode: identity.authMode || login.authMode,
      expiresAt: identity.expiresAt || login.expiresAt
    }
  };
}

export async function authenticateGateRequest(config, request) {
  const founderGatewayKey = extractFounderGatewayKey(request);
  const bearerToken = extractBearerToken(request);

  if (!founderGatewayKey && !bearerToken) {
    return {
      ok: false,
      reason: 'missing_gate_credentials',
      identity: null,
      sessionToken: null
    };
  }

  try {
    if (bearerToken) {
      const identity = await readGateSessionIdentity(config, bearerToken);
      return {
        ok: true,
        reason: null,
        identity,
        sessionToken: bearerToken
      };
    }

    const exchanged = await exchangeGateTokenForIdentity(config, founderGatewayKey);
    return {
      ok: true,
      reason: null,
      identity: exchanged.identity,
      sessionToken: exchanged.sessionToken
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      identity: null,
      sessionToken: null
    };
  }
}

export function isFounderGateIdentity(identity) {
  return Boolean(identity?.founderGateway || identity?.authMode === 'founder-gateway');
}