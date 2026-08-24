// Backend HTTP error bodies crossing the Electron IPC boundary.
//
// fetchJson / fetchJsonViaOauthSession (main) reject HTTP >= 400 as
// `new Error(`${status}: ${body}`)`, and Electron's structured-clone of a
// rejected invoke keeps ONLY .message — every custom prop (statusCode, typed
// body) is stripped, so renderer callers (app api/ helpers, plugin ctx.rest)
// see a string-only Error and typed readers (error.detail.category) find
// nothing. That class of bug broke Spotify F2: the 404 no_active_device
// category never reached the plugin's recovery branch (QA f2_diag8: the
// rejection arrived with Object.keys(e) === []).
//
// The message string is the ONLY channel that survives IPC, so the class fix
// has two halves sharing this module (no import cycle: pure helpers):
//   main    — makeApiError(): reject with .statusCode + .__hermesApiError
//             typed props (readable main-side) while keeping the exact
//             `${status}: ${json}` message contract for older preloads.
//   preload — restoreApiError(): rehydrate .detail/.category/.status/.body on
//             the rejected Error so EVERY renderer consumer reads typed fields
//             again without per-call-site string parsing.

// `status: {json}` at the END of the message; tolerate the
// "Error invoking remote method 'hermes:api': Error:" prefix Electron adds.
// The status code must not be part of a longer digit run (non-capturing
// lookbehind-free guard: preceded by start or a non-digit).
const FLATTENED_API_ERROR = /(?:^|\D)(\d{3}):\s*(\{.*\})\s*$/

export interface ApiErrorBody {
  status?: number
  ok?: boolean
  category?: string
  detail?: Record<string, unknown> & { category?: string; retry_after_seconds?: number }
  retry_after_seconds?: number
  [key: string]: unknown
}

export interface ApiError extends Error {
  status?: number
  body?: ApiErrorBody
  detail?: ApiErrorBody['detail']
  category?: string
  retry_after_seconds?: number
  // Main-process-only props: present before the IPC hop, stripped by
  // structured-clone (preload restores the rest from the message string).
  statusCode?: number
  __hermesApiError?: { status: number; body: ApiErrorBody }
}

/** Best-effort parse of a flattened `status: {json}` IPC error message into a
 * typed body. Returns null when the message isn't that shape — callers keep
 * their generic handling for transport errors and malformed payloads. */
export function parseFlattenedApiError(message: string): { status: number; body: ApiErrorBody } | null {
  const match = FLATTENED_API_ERROR.exec(String(message || ''))

  if (!match) {return null}

  let body: unknown

  try {
    body = JSON.parse(match[2])
  } catch {
    return null
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {return null}

  return { status: Number(match[1]), body: body as ApiErrorBody }
}

/** True when the HTTP error body is a JSON object — only then can typed
 * fields survive the message-only channel. */
function tryParseBody(text: string): ApiErrorBody | null {
  const trimmed = (text || '').trim()

  if (!trimmed.startsWith('{')) {return null}

  try {
    const parsed = JSON.parse(trimmed)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ApiErrorBody) : null
  } catch {
    return null
  }
}

/** Main-process rejection for backend HTTP >= 400. Keeps the historical
 * `${status}: ${text}` message byte-compatible (older preloads and plugins
 * parse it out of the string) while attaching typed props for same-process
 * callers. IPC strips the props; preload restores them from the message. */
export function makeApiError(status: number, text: string, fallbackText?: string): ApiError {
  const body = tryParseBody(text)
  const error = new Error(`${status}: ${text || fallbackText || ''}`) as ApiError
  error.statusCode = status

  if (body) {
    error.__hermesApiError = { status, body }
    error.detail = body.detail
    error.category = body.category ?? body.detail?.category
    error.status = status
    error.body = body
  }

  return error
}

/** Preload-side rehydration of an invoke rejection. Returns a NEW Error only
 * when the flattened API-error shape is detected; otherwise returns the
 * original error untouched (transport failures stay generic). The original
 * message is preserved on .message. */
export function restoreApiError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error)
  const parsed = parseFlattenedApiError(message)

  if (!parsed) {return error}

  const restored = (error instanceof Error ? error : new Error(message)) as ApiError
  restored.detail = parsed.body.detail
  restored.category = parsed.body.category ?? parsed.body.detail?.category
  restored.retry_after_seconds = parsed.body.retry_after_seconds ?? parsed.body.detail?.retry_after_seconds
  restored.status = parsed.status
  restored.body = parsed.body

  return restored
}
