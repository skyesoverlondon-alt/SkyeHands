# Skye-0s-Auth-Portal

**The single source of auth truth for all 0s platforms.**

This portal consolidates authentication infrastructure across the full Skyes Over London stack. Everything runs through the 0megaSkyeGate.

---

## Components

### 1. 0megaSkyeGate — Primary Auth Worker
**Location:** `../0megaSkyeGate/0megaSkyeGate-The-Actual-Gate/`  
**Deployed:** `https://0megaskyegate.skyesoverlondon.workers.dev`

Live endpoints:
- `POST /v1/auth/login` — body `{ token: string }` → returns `{ ok, session_token, expires_at }`
- `POST /v1/auth/logout` — `Authorization: Bearer <session_token>` → revokes session
- `GET /v1/auth/me` — `Authorization: Bearer <session_token>` → returns `{ ok, session: { id, app_id, org_id, auth_mode, expires_at } }`

Auth modes:
- `founder-gateway` — founder key (FOUNDER_GATEWAY_KEY env var or `x-founders-gateway-key` header)
- `app-token` — per-app token from D1 `app_tokens` table

---

### 2. 0s-auth-sdk — Universal Client-Side SDK
**Location:** `../0s-auth-sdk/`  
**Script tag:** `<script src="/0s-auth-sdk/index.js"></script>`  
**Global:** `window.OmegaAuth`

API:
```js
// Require a valid session (redirects to login if none)
await OmegaAuth.requireSession();

// Get session object (null if not logged in)
const session = await OmegaAuth.getSession();

// Get raw Bearer token string
const token = OmegaAuth.getToken();

// Server-side (Netlify functions / Node)
const { ok, session } = await OmegaAuth.verifyRequest(event);
```

Login page: `/0s-auth-sdk/0s-login.html?return_to=<url>`

---

### 3. SuperIDE Worker — CF Access Verifier
**Location:** `../SuperIDE/worker/src/access.ts`

Verifies Cloudflare Access JWTs (RS256) for the SuperIDE worker layer.  
Also normalizes legacy `skyesol` endpoint URLs to the live gate URL.

---

## Integration Patterns

### HTML App (client-side gating)
```html
<!-- In <head> -->
<script src="/0s-auth-sdk/index.js"></script>

<!-- In app init JS -->
const session = await OmegaAuth.requireSession();
// app continues with session.app_id, session.auth_mode, etc.
```

### Netlify Function (server-side, additive — keep existing Netlify Identity)
```js
const { OmegaAuth } = require('../../../0s-auth-sdk');

// Existing Netlify Identity check stays — gate is ADDITIVE
const gateResult = await OmegaAuth.verifyRequest(event);
if (!gateResult.ok) return { statusCode: 401, body: '{"error":"not authorized"}' };
```

### Netlify Function (NobleSoles pattern — already implemented)
```js
const { requireGateSession } = require('../_lib/auth');
const gateResult = await requireGateSession(event);
if (!gateResult.ok) return gateResult.response;
```

---

## Platform Coverage

| Platform | Gate Wired | Notes |
|---|---|---|
| 0megaSkyeGate | ✓ | Source of truth |
| 0s-auth-sdk | ✓ | SDK deployed |
| SkyDexia-2.6 | ✓ | auth-unlock.js uses gate |
| Kaixu67 adminkai.html | ✓ | SDK loaded |
| NobleSoles auth.js | ✓ | requireGateSession implemented |
| SuperIDE public/index.html | ✓ | OmegaAuth.requireSession() |
| SuperIDE ContractorNetwork | ✓ | OmegaAuth.requireSession() |
| SuperIDE DemonLeadForge | ✓ | SDK loaded |
| SkyDex standalone-session.js | ✓ | Backed by OmegaAuth |
| SkyDex auth-unlock.js | ✓ | Uses OmegaAuth.getToken() |
| SkaixuPro SkyeVault | ✓ | Gate bridge added |
| SkaixuPro skAIxuide | ✓ | OmegaAuth.requireSession() |
| SkyeBundle tools | ✓ | All 15 tools wired |
| SuperIDE public apps | ✓ | All apps wired |
| Kaixu67 portal.html | ✓ | OmegaAuth.requireSession() |
| SkyeDexia session bridge | ✓ | OmegaAuth backed |
| SuperIDEia session bridge | ✓ | OmegaAuth backed |

---

## Stack Clarification

The Netlify layer (Identity, Forms, Blobs) is **part of the stack and stays**.  
The gate is **additive SSO on top of Netlify** — both can coexist.  
Gate auth = cross-platform SSO token.  
Netlify Identity = per-site user management.  
They serve different purposes and complement each other.
