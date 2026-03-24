/**
 * 0s-auth-sdk — Unified Sky0s platform session SDK
 * Single-file, zero-dependency, vanilla JS.
 *
 * Usage (browser):
 *   <script src="/0s-auth-sdk/index.js"></script>
 *   <script>
 *     OmegaAuth.requireSession(); // redirect to login if no valid session
 *     const me = await OmegaAuth.getSession(); // null if not logged in
 *   </script>
 *
 * Usage (Netlify/Node function):
 *   const OmegaAuth = require('./0s-auth-sdk/index.js');
 *   const session = await OmegaAuth.verifyRequest(event); // null if invalid
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node / Netlify functions
    module.exports = factory(typeof fetch !== 'undefined' ? fetch.bind(globalThis) : require('node-fetch'));
  } else {
    // Browser
    root.OmegaAuth = factory(window.fetch.bind(window));
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (fetchFn) {

  // ── Config ─────────────────────────────────────────────────────────────────
  var GATE_URL = 'https://0megaskyegate.skyesoverlondon.workers.dev';
  var STORAGE_KEY = '0s_session';
  var LOGIN_PAGE = '/0s-auth-sdk/0s-login.html';

  // Allow override before SDK loads: <script>window._0S_GATE_URL='...'</script>
  if (typeof window !== 'undefined' && window._0S_GATE_URL) {
    GATE_URL = window._0S_GATE_URL;
  }
  if (typeof window !== 'undefined' && window._0S_LOGIN_PAGE) {
    LOGIN_PAGE = window._0S_LOGIN_PAGE;
  }

  // ── Storage helpers (browser only) ─────────────────────────────────────────
  function saveSession(token, expiresAt) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: token, expires_at: expiresAt }));
    } catch (e) { /* storage blocked */ }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.token) return null;
      if (obj.expires_at && new Date(obj.expires_at) <= new Date()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return obj;
    } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ── Gate API calls ──────────────────────────────────────────────────────────
  async function callMe(token) {
    var res = await fetchFn(GATE_URL + '/v1/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return null;
    var body = await res.json();
    return body.ok ? body.session : null;
  }

  async function callLogin(accessToken) {
    var res = await fetchFn(GATE_URL + '/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken })
    });
    var body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || 'Login failed');
    return body; // { ok, session_token, expires_at }
  }

  async function callLogout(token) {
    try {
      await fetchFn(GATE_URL + '/v1/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
    } catch (e) { /* best-effort */ }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns the current session record from the gate, or null if not logged in
   * or the session is expired/revoked.
   */
  async function getSession() {
    var stored = loadSession();
    if (!stored) return null;
    var session = await callMe(stored.token);
    if (!session) { clearSession(); return null; }
    return session;
  }

  /**
   * Redirects to the login page if there is no valid session.
   * Returns the session if valid.
   * @param {string} [returnUrl] - URL to return to after login (defaults to current page)
   */
  async function requireSession(returnUrl) {
    var session = await getSession();
    if (!session) {
      var returnTo = returnUrl || (typeof window !== 'undefined' ? window.location.href : '');
      var loginUrl = LOGIN_PAGE + (returnTo ? '?return_to=' + encodeURIComponent(returnTo) : '');
      if (typeof window !== 'undefined') window.location.replace(loginUrl);
      return null;
    }
    return session;
  }

  /**
   * Logs in with an access token (app token or founder key).
   * Stores the session in localStorage.
   * @param {string} accessToken
   * @returns {Promise<{session_token, expires_at}>}
   */
  async function login(accessToken) {
    var result = await callLogin(accessToken);
    saveSession(result.session_token, result.expires_at);
    return result;
  }

  /**
   * Logs out the current session (revokes server-side) and clears localStorage.
   */
  async function logout() {
    var stored = loadSession();
    if (stored) await callLogout(stored.token);
    clearSession();
  }

  /**
   * Returns the raw session token string, or null.
   */
  function getToken() {
    var stored = loadSession();
    return stored ? stored.token : null;
  }

  /**
   * Node/Netlify: verify the Bearer token from an incoming event/request.
   * @param {object} event - Netlify function event or { headers: {...} }
   * @returns {Promise<session | null>}
   */
  async function verifyRequest(event) {
    var authHeader = (event && event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    var token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    return await callMe(token);
  }

  return {
    getSession: getSession,
    requireSession: requireSession,
    login: login,
    logout: logout,
    getToken: getToken,
    verifyRequest: verifyRequest,
    // Expose config for overriding in tests
    _GATE_URL: function () { return GATE_URL; },
  };

}));
