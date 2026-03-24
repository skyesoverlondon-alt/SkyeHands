(function(){
  const TOKEN_KEY = 'kx.api.accessToken';
  const EMAIL_KEY = 'kx.api.tokenEmail';
  const LEGACY_TOKEN_KEY = 'kaixu_api_key';
  const INTENT_KEY = 'skydexia26.intent.log';

  function readSessionValue(key){
    try { return String(sessionStorage.getItem(key) || '').trim(); } catch { return ''; }
  }
  function writeSessionValue(key, value){
    try {
      const nextValue = String(value || '').trim();
      if (nextValue) sessionStorage.setItem(key, nextValue);
      else sessionStorage.removeItem(key);
    } catch {}
  }
  function readLocalValue(key){
    try { return String(localStorage.getItem(key) || '').trim(); } catch { return ''; }
  }
  function removeLocalValue(key){
    try { localStorage.removeItem(key); } catch {}
  }
  function migrateLegacyToken(){
    const sessionToken = readSessionValue(TOKEN_KEY);
    const sessionEmail = readSessionValue(EMAIL_KEY);
    const legacyToken = sessionToken || readLocalValue(TOKEN_KEY) || readLocalValue(LEGACY_TOKEN_KEY);
    const legacyEmail = sessionEmail || readLocalValue(EMAIL_KEY);
    if (legacyToken && !sessionToken) writeSessionValue(TOKEN_KEY, legacyToken);
    if (legacyEmail && !sessionEmail) writeSessionValue(EMAIL_KEY, legacyEmail);
    if (legacyToken) {
      removeLocalValue(TOKEN_KEY);
      removeLocalValue(LEGACY_TOKEN_KEY);
    }
    if (legacyEmail) removeLocalValue(EMAIL_KEY);
    return { token: legacyToken, email: legacyEmail };
  }

  function readToken(){
    const migrated = migrateLegacyToken();
    return String(migrated.token || '').trim();
  }
  function readTokenEmail(){
    const migrated = migrateLegacyToken();
    return String(migrated.email || '').trim();
  }
  function saveManualToken(token, email){
    try {
      writeSessionValue(TOKEN_KEY, token);
      writeSessionValue(EMAIL_KEY, email);
      removeLocalValue(TOKEN_KEY);
      removeLocalValue(LEGACY_TOKEN_KEY);
      removeLocalValue(EMAIL_KEY);
    } catch {}
  }
  function shouldAttachBearer(url){
    try {
      const target = new URL(String(url || ''), window.location.href);
      return target.origin !== window.location.origin;
    } catch {
      return true;
    }
  }
  async function request(url, options){
    const headers = new Headers(options?.headers || {});
    const token = readToken();
    if (token && shouldAttachBearer(url) && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `${response.status} ${response.statusText}`);
    return payload;
  }
  async function recordSuiteIntent(record){
    try {
      const current = JSON.parse(localStorage.getItem(INTENT_KEY) || '[]');
      current.unshift({ id: Date.now().toString(36), created_at: new Date().toISOString(), ...(record || {}) });
      localStorage.setItem(INTENT_KEY, JSON.stringify(current.slice(0, 50)));
      return { ok: true };
    } catch { return { ok: false }; }
  }
  function openApp(appName, params){
    console.info('SkyeStandaloneSession.openApp', appName, params || {});
  }
  window.SkyeStandaloneSession = { readToken, readTokenEmail, saveManualToken, request, recordSuiteIntent, openApp };
})();
