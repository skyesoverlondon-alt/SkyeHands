(function () {
  'use strict';

  var GATE_URL = 'https://0megaskyegate.skyesoverlondon.workers.dev';
  var SESSION_KEY = '0s_session';
  var LOGIN_PAGE = '/0s-auth-sdk/0s-login.html';

  // Allow host-page overrides before this script loads
  if (window._0S_GATE_URL) GATE_URL = window._0S_GATE_URL;
  if (window._0S_LOGIN_PAGE) LOGIN_PAGE = window._0S_LOGIN_PAGE;

  var _unlocked = false;
  var _pending = true;

  function readStoredSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.token) return null;
      if (obj.expires_at && new Date(obj.expires_at) <= new Date()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return obj.token;
    } catch (e) { return null; }
  }

  function redirectLogin() {
    var returnTo = encodeURIComponent(window.location.href);
    window.location.replace(LOGIN_PAGE + '?return_to=' + returnTo);
  }

  async function verify() {
    var token = readStoredSession();
    if (!token) { redirectLogin(); return; }

    try {
      var res = await fetch(GATE_URL + '/v1/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      var body = await res.json().catch(function () { return {}; });
      if (res.ok && body.ok) {
        _unlocked = true;
        _pending = false;
        window.dispatchEvent(new CustomEvent('auth:unlocked', { detail: body.session }));
        return;
      }
    } catch (e) { /* network error — fall through */ }

    // Invalid / expired / revoked
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    redirectLogin();
  }

  window.AuthUnlock = {
    enabled: true,
    /** Synchronous fast-path for backward compatibility (true only after verify() resolves) */
    isUnlocked: function () { return _unlocked; },
    /** Promise that resolves to true/false after gate verification */
    check: function () { return verify().then(function () { return _unlocked; }); },
    /** Returns the raw session token string or null */
    getToken: function () { return readStoredSession(); },
  };

  // Kick off verification immediately on script load
  verify();
}());

