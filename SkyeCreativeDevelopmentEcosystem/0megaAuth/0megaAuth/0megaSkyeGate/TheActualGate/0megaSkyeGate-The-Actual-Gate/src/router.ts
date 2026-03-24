import type { Env } from './types'
import { json } from './utils/json'
import { toHttpError } from './utils/errors'
import { handleHealth } from './routes/health'
import { handleModels } from './routes/models'
import { handleChat } from './routes/chat'
import { handleStream } from './routes/stream'
import { handleCreateImage, handleGetImageJob } from './routes/images'
import { handleCreateVideo, handleGetVideoJob } from './routes/videos'
import { handleAudioSpeech } from './routes/audio-speech'
import { handleAudioTranscriptions } from './routes/audio-transcriptions'
import { handleRealtimeSession } from './routes/realtime-session'
import { handleEmbeddings } from './routes/embeddings'
import { handleUsage } from './routes/usage'
import { handleWalletBalance } from './routes/wallet-balance'
import { handleGetJob } from './routes/jobs'
import { handleAdminTrace } from './routes/admin-traces'
import { handleAdminJob } from './routes/admin-jobs'
import { handleAdminUpstream } from './routes/admin-upstream'
import { handleAdminRetryJob, handleAdminCancelJob } from './routes/admin-job-actions'
import { handleAdminWallets } from './routes/admin-wallets'
import { handleAdminProviders } from './routes/admin-providers'
import { handleAdminAliases } from './routes/admin-aliases'
import { handleAdminRouting } from './routes/admin-routing'
import { handleErrorsIngest, handleErrorsList, handleErrorsGet } from './routes/errors-ingest'
import { handleErrorsAdminList, handleErrorsAdminCleanup } from './routes/errors-admin'
import { handleSmokeRun, handleSmokeLog, handleSmokeAudit, handleSmokeEndpoints, handleSmokeFounderFallback, handleSmokehouse } from './routes/smoke'
import { handleBrainsList, handleBrainsResolve } from './routes/brains'
import { handleKeysIssue } from './routes/keys-issue'
import { handleKeysList } from './routes/keys-list'
import { handleKeysRevoke } from './routes/keys-revoke'
import { handleAuthLogin, handleAuthLogout, handleAuthMe } from './routes/auth'
import {
  handleNetlifyBlobRequest,
  handleNetlifyConfigStatus,
  handleNetlifyFormsSubmit,
  handleNetlifyIdentityLogin,
  handleNetlifyIdentityUser,
} from './routes/netlify'
import { handleOpenAIChatCompletions } from './routes/openai-chat-completions'

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method.toUpperCase()

    // ── Inference lanes ────────────────────────────────────────────────────────
    if (path === '/v1/health' && method === 'GET') return await handleHealth(request, env)

    // ── Unified session auth ───────────────────────────────────────────────────────────
    if (path === '/v1/auth/login'  && method === 'POST') return await handleAuthLogin(request, env)
    if (path === '/v1/auth/logout' && method === 'POST') return await handleAuthLogout(request, env)
    if (path === '/v1/auth/me'     && method === 'GET')  return await handleAuthMe(request, env)
    if (path === '/v1/netlify' && method === 'GET') return await handleNetlifyConfigStatus(request, env)
    if (path === '/v1/netlify/identity/login' && method === 'POST') return await handleNetlifyIdentityLogin(request, env)
    if (path === '/v1/netlify/identity/user' && method === 'GET') return await handleNetlifyIdentityUser(request, env)
    if (path === '/v1/models' && method === 'GET') return await handleModels(request, env)
    if (path === '/v1/chat/completions' && method === 'POST') return await handleOpenAIChatCompletions(request, env)
    if (path === '/v1/chat' && method === 'POST') return await handleChat(request, env)
    if (path === '/v1/stream' && method === 'POST') return await handleStream(request, env)
    if (path === '/v1/embeddings' && method === 'POST') return await handleEmbeddings(request, env)
    if (path === '/v1/images' && method === 'POST') return await handleCreateImage(request, env)
    if (path === '/v1/videos' && method === 'POST') return await handleCreateVideo(request, env)
    if (path === '/v1/audio/speech' && method === 'POST') return await handleAudioSpeech(request, env)
    if (path === '/v1/audio/transcriptions' && method === 'POST') return await handleAudioTranscriptions(request, env)
    if (path === '/v1/realtime/session' && method === 'POST') return await handleRealtimeSession(request, env)

    // ── Wallet / usage ─────────────────────────────────────────────────────────
    if (path === '/v1/usage' && method === 'GET') return await handleUsage(request, env)
    if (path === '/v1/wallet' && method === 'GET') return await handleWalletBalance(request, env)

    // ── Error reporting ────────────────────────────────────────────────────────
    if (path === '/v1/errors/event' && method === 'POST') return await handleErrorsIngest(request, env)
    if (path === '/v1/errors/events' && method === 'GET') return await handleErrorsList(request, env)

    // ── Job polling ────────────────────────────────────────────────────────────
    const imageMatch = /^\/v1\/images\/([^/]+)$/.exec(path)
    if (imageMatch && method === 'GET') return await handleGetImageJob(request, env, imageMatch[1])

    const videoMatch = /^\/v1\/videos\/([^/]+)$/.exec(path)
    if (videoMatch && method === 'GET') return await handleGetVideoJob(request, env, videoMatch[1])

    const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(path)
    if (jobMatch && method === 'GET') return await handleGetJob(request, env, jobMatch[1])

    const netlifyFormsMatch = /^\/v1\/netlify\/forms\/([^/]+)$/.exec(path)
    if (netlifyFormsMatch && method === 'POST') return await handleNetlifyFormsSubmit(request, env, netlifyFormsMatch[1])

    const netlifyBlobMatch = /^\/v1\/netlify\/blobs\/(.+)$/.exec(path)
    if (netlifyBlobMatch && ['GET', 'PUT', 'DELETE', 'HEAD'].includes(method)) {
      return await handleNetlifyBlobRequest(request, env, netlifyBlobMatch[1])
    }

    const errEventMatch = /^\/v1\/errors\/events\/([^/]+)$/.exec(path)
    if (errEventMatch && method === 'GET') return await handleErrorsGet(request, env, errEventMatch[1])

    // ── Admin — infra ──────────────────────────────────────────────────────────
    const adminTraceMatch = /^\/admin\/traces\/([^/]+)$/.exec(path)
    if (adminTraceMatch && method === 'GET') return await handleAdminTrace(request, env, adminTraceMatch[1])

    const adminJobMatch = /^\/admin\/jobs\/([^/]+)$/.exec(path)
    if (adminJobMatch && method === 'GET') return await handleAdminJob(request, env, adminJobMatch[1])

    const adminUpstreamMatch = /^\/admin\/upstream\/([^/]+)$/.exec(path)
    if (adminUpstreamMatch && method === 'GET') return await handleAdminUpstream(request, env, adminUpstreamMatch[1])

    const adminRetryMatch = /^\/admin\/retry\/([^/]+)$/.exec(path)
    if (adminRetryMatch && method === 'POST') return await handleAdminRetryJob(request, env, adminRetryMatch[1])

    const adminCancelMatch = /^\/admin\/cancel\/([^/]+)$/.exec(path)
    if (adminCancelMatch && method === 'POST') return await handleAdminCancelJob(request, env, adminCancelMatch[1])

    // ── Admin — data ───────────────────────────────────────────────────────────
    if (path === '/admin/wallets' && method === 'GET') return await handleAdminWallets(request, env)
    if (path === '/admin/providers' && method === 'GET') return await handleAdminProviders(request, env)
    if (path === '/admin/aliases' && method === 'GET') return await handleAdminAliases(request, env)
    if (path === '/admin/routing' && method === 'GET') return await handleAdminRouting(request, env)

    // ── Admin — brains ─────────────────────────────────────────────────────────
    if (path === '/admin/brains' && method === 'GET') return await handleBrainsList(request, env)
    if (path === '/admin/brains/resolve' && method === 'POST') return await handleBrainsResolve(request, env)

    // ── Admin — keys ───────────────────────────────────────────────────────────
    if (path === '/admin/keys/issue' && method === 'POST') return await handleKeysIssue(request, env)
    if (path === '/admin/keys/list' && method === 'GET') return await handleKeysList(request, env)
    if (path === '/admin/keys/revoke' && method === 'POST') return await handleKeysRevoke(request, env)

    // ── Admin — errors ─────────────────────────────────────────────────────────
    if (path === '/admin/errors/events' && method === 'GET') return await handleErrorsAdminList(request, env)
    if (path === '/admin/errors/cleanup' && method === 'POST') return await handleErrorsAdminCleanup(request, env)

    // ── Admin — smoke ──────────────────────────────────────────────────────────
    if (path === '/admin/smoke/audit' && method === 'GET') return await handleSmokeAudit(request, env)
    if (path === '/admin/smoke/log' && method === 'GET') return await handleSmokeLog(request, env)
    if (path === '/admin/smoke/run' && method === 'POST') return await handleSmokeRun(request, env)
    if (path === '/admin/smoke/founder-fallback' && method === 'POST') return await handleSmokeFounderFallback(request, env)
    if (path === '/admin/smoke/endpoints' && method === 'GET') return await handleSmokeEndpoints(request, env)
    if (path === '/smokehouse') return await handleSmokehouse(request, env)

    return json({ ok: false, error: { code: 'NOT_FOUND', message: `No route for ${method} ${path}` } }, 404)
  } catch (error) {
    const httpError = toHttpError(error)
    return json({ ok: false, error: { code: httpError.code, message: httpError.message } }, httpError.status)
  }
}
