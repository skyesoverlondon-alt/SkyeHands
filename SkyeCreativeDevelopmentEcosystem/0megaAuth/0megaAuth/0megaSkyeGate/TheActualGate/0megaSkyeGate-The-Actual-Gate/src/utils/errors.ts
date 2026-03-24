export class KaixuError extends Error {
  status: number
  code: string
  adminDetail?: string
  raw?: unknown

  constructor(status: number, code: string, message: string, options?: { adminDetail?: string; raw?: unknown }) {
    super(message)
    this.status = status
    this.code = code
    this.adminDetail = options?.adminDetail
    this.raw = options?.raw
  }
}

export class HttpError extends KaixuError {}

export function isHttpError(error: unknown): error is KaixuError {
  return error instanceof KaixuError
}

function inferCode(status: number): string {
  if (status === 400) return 'KAIXU_INVALID_INPUT'
  if (status === 401 || status === 403) return 'KAIXU_UNAUTHORIZED'
  if (status === 404) return 'KAIXU_ASSET_UNAVAILABLE'
  if (status === 408 || status === 504) return 'KAIXU_UPSTREAM_TIMEOUT'
  if (status === 429) return 'KAIXU_RATE_LIMITED'
  if (status >= 500) return 'KAIXU_ENGINE_UNAVAILABLE'
  return 'KAIXU_INTERNAL_ERROR'
}

export function sanitizeMessage(code: string): string {
  switch (code) {
    case 'KAIXU_UNAUTHORIZED':
      return 'This Kaixu route is not authorized for the current caller.'
    case 'KAIXU_ENGINE_UNAVAILABLE':
      return 'The requested Kaixu engine is unavailable right now.'
    case 'KAIXU_LANE_DISABLED':
      return 'This Kaixu lane is disabled or not configured.'
    case 'KAIXU_JOB_FAILED':
      return 'The Kaixu job failed before completion.'
    case 'KAIXU_UPSTREAM_TIMEOUT':
      return 'The Kaixu gateway timed out while waiting on the engine lane.'
    case 'KAIXU_RATE_LIMITED':
      return 'This Kaixu route is temporarily rate-limited.'
    case 'KAIXU_INVALID_INPUT':
      return 'The request payload is invalid for this Kaixu route.'
    case 'KAIXU_ASSET_UNAVAILABLE':
      return 'The requested Kaixu asset is unavailable.'
    default:
      return 'The Kaixu gateway hit an internal error.'
  }
}

export async function fromUpstreamResponse(response: Response, fallbackCode = 'KAIXU_ENGINE_UNAVAILABLE'): Promise<KaixuError> {
  const rawText = await response.text()
  const code = response.status === 429 ? 'KAIXU_RATE_LIMITED' : response.status === 408 || response.status === 504 ? 'KAIXU_UPSTREAM_TIMEOUT' : response.status === 400 ? 'KAIXU_INVALID_INPUT' : response.status >= 500 ? 'KAIXU_ENGINE_UNAVAILABLE' : fallbackCode
  return new KaixuError(response.status || 502, code, sanitizeMessage(code), { adminDetail: rawText || response.statusText, raw: rawText })
}

export function toHttpError(error: unknown): KaixuError {
  if (isHttpError(error)) return error
  if (error instanceof SyntaxError) {
    return new KaixuError(400, 'KAIXU_INVALID_INPUT', sanitizeMessage('KAIXU_INVALID_INPUT'), { adminDetail: error.message, raw: error })
  }
  if (error instanceof Error) {
    return new KaixuError(500, inferCode(500), sanitizeMessage('KAIXU_INTERNAL_ERROR'), { adminDetail: error.message, raw: error.stack ?? error.message })
  }
  return new KaixuError(500, 'KAIXU_INTERNAL_ERROR', sanitizeMessage('KAIXU_INTERNAL_ERROR'), { raw: error })
}
