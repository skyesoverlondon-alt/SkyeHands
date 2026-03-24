// Runtime gate URL injection for frontend pages.
// Include as a <script src="/omega-gate.config.js"></script> in any HTML page.
// Override by setting window.OMEGA_GATE_URL before this script, or via localStorage.
(function () {
  function safeGetStoredGateUrl() {
    try {
      return localStorage.getItem('OMEGA_GATE_URL') || '';
    } catch (_) {
      return '';
    }
  }

  function readMetaGateUrl() {
    try {
      const node = document.querySelector('meta[name="omega-gate-url"]');
      return node ? String(node.content || '').trim() : '';
    } catch (_) {
      return '';
    }
  }

  function readOrigin() {
    try {
      return window.location.origin || '';
    } catch (_) {
      return '';
    }
  }

  function normalizeGateUrl(raw) {
    const value = String(raw || '').trim();
    return value ? value.replace(/\/+$/, '') : '';
  }

  function resolveOmegaGateUrl(fallback) {
    return normalizeGateUrl(
      window.OMEGA_GATE_URL || safeGetStoredGateUrl() || readMetaGateUrl() || fallback || readOrigin()
    );
  }

  window.resolveOmegaGateUrl = resolveOmegaGateUrl;
  window.OMEGA_GATE_URL = resolveOmegaGateUrl();
  window.OMEGA_GATE_META = {
    canonicalSourcePath: '/workspaces/SkyeCDE/Skye0s-s0l26/Sky0s-Platforms/0megaSkyeGate/0megaSkyeGate-The-Actual-Gate',
    defaultRuntimeUrl: readOrigin() || null,
  };
})();
