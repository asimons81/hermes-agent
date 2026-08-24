// Rehydrate backend error bodies rejected across the Electron IPC boundary.
//
// fetchJson (main) rejects HTTP >= 400 as new Error(`${status}: ${body}`), and
// Electron's structured-clone of a rejected Error keeps ONLY .message — the
// typed JSON body ({"detail":{"category":"no_active_device",...}}) survives as
// text inside the string, so renderer callers (plugin ctx.rest) see a
// string-only Error and their typed readers (error.detail.category etc.) find
// nothing. That class of bug is what broke Spotify F2: the 404 no_active_device
// category never reached the plugin's recovery branch.
//
// Pure helpers, main-process side: parse the flattened shape back out.
// Reused by preload-side normalization (same regex contract, no import cycle).

// Match "<status>: <json-body>" where the body is a JSON object with a detail
// or category field. Non-JSON bodies (HTML fallbacks, status text) stay null.
const FLATTENED_API_ERROR = /^(\d{3}):\s*(\{.*\})\s*$/

export interface ApiErrorBody {
  status?: number
  ok?: boolean
  category?: string
  detail?: Record<string, unknown> & { category?: string; retry_after_seconds?: number }
  retry_after_seconds?: number
  [key: string]: unknown
}

/** Best-effort parse of a flattened `status: {json}` IPC error message into a
 * typed body. Returns null when the message isn't that shape — callers keep
 * their generic handling for transport errors and malformed payloads. */
export function parseFlattenedApiError(message: string): { status: number; body: ApiErrorBody } | null {
  const match = FLATTENED_API_ERROR.exec(String(message || ''))
  if (!match) return null

  let body: unknown
  try {
    body = JSON.parse(match[2])
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null

  return { status: Number(match[1]), body: body as ApiErrorBody }
}
