/**
 * SkyeErrors SDK (Cloudflare Workers)
 * Skyes Over London LC
 *
 * Usage:
 *   import { createSkyeErrorsClient } from "./skye-errors-sdk.mjs";
 *   const skye = createSkyeErrorsClient({ endpoint: env.KAIXU_BRAIN_URL, token: env.KAIXU_APP_TOKEN, app: "my-worker" });
 *   export default { fetch: skye.withSkyeErrors(async (req, env, ctx) => { ... }, (req, env) => ({ tags: { tenant: "acme" } })) }
 */

function safeString(x, maxLen = 20000) {
  const s = typeof x === "string" ? x : (() => {
    try { return JSON.stringify(x); } catch { return String(x); }
  })();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

function scrubUrl(urlStr, scrubQuery = true) {
  try {
    const u = new URL(urlStr);
    return scrubQuery ? `${u.origin}${u.pathname}` : `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return String(urlStr || "");
  }
}

function requestContext(request, scrubQuery = true) {
  if (!request) return undefined;
  return {
    method: request.method,
    url: scrubUrl(request.url, scrubQuery),
    cf_ray: request.headers.get("cf-ray") || undefined,
  };
}

export function createSkyeErrorsClient(opts) {
  if (!opts || !opts.endpoint || !opts.token) throw new Error("SkyeErrors: endpoint and token are required.");
  const endpoint = String(opts.endpoint).replace(/\/+$/, "");
  const token = String(opts.token);
  const app = opts.app ? String(opts.app) : undefined;
  const release = opts.release ? String(opts.release) : undefined;
  const environment = opts.environment ? String(opts.environment) : undefined;
  const scrubQuery = opts.scrubUrlQuery !== false;

  async function send(payload) {
    // Prefer ctx.waitUntil() when calling this from a Worker request.
    await fetch(`${endpoint}/v1/errors/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  function buildPayload(err, ctx) {
    const name = safeString(err?.name || "Error", 200);
    const message = safeString(err?.message || String(err) || "Unknown error", 2000);
    const stack = safeString(err?.stack || "", 20000);

    const tags = {
      ...(opts.tags || {}),
      ...(ctx?.tags || {}),
    };
    if (app) tags.app = app;

    return {
      ts_ms: Date.now(),
      level: ctx?.level || "error",
      name,
      message,
      stack,
      release,
      environment,
      tags,
      request: requestContext(ctx?.request, scrubQuery),
      extra: ctx?.extra || undefined,
      runtime: "cloudflare-worker",
    };
  }

  return {
    captureException(err, ctx) {
      const payload = buildPayload(err, ctx);
      return send(payload);
    },

    withSkyeErrors(handler, enrich) {
      return async (request, env, cfCtx) => {
        try {
          return await handler(request, env, cfCtx);
        } catch (err) {
          const extraCtx = enrich ? enrich(request, env) : {};
          cfCtx.waitUntil(
            this.captureException(err, { request, ...extraCtx, level: "error" })
          );
          throw err;
        }
      };
    }
  };
}
