import assert from 'node:assert/strict'

import { test } from 'vitest'

import type { ApiError} from './api-error-restore';
import { makeApiError, parseFlattenedApiError, restoreApiError } from './api-error-restore'

// Contract: the exact shape QA captured on the live rejection —
// `Error invoking remote method 'hermes:api': Error: 404:
//  {"detail":{"ok":false,"category":"no_active_device",...}}` with
// Object.keys(e) === [] — must round-trip back into a typed Error so
// renderer/plugin readers (error.detail.category) work again. Transport
// errors and malformed payloads stay untouched.

/** Simulate Electron's structured-clone of a rejected invoke: a fresh Error
 * carrying ONLY .message — every custom prop (statusCode, __hermesApiError,
 * detail, …) is stripped. That stripping is the F2 bug's mechanism. */
function ipcStrip(error: unknown): Error {
  return new Error(error instanceof Error ? error.message : String(error))
}

/** QA's exact probe: own enumerable props (Object.keys(e)). Errors carry
 * .message/.stack on the prototype, so a flattened error yields []. */
function ownEnumerableProps(error: unknown): string[] {
  return Object.keys(error as Record<string, unknown>)
}

const QA_MESSAGE = `Error invoking remote method 'hermes:api': Error: 404: ${JSON.stringify({
  detail: { ok: false, category: 'no_active_device', retry_after_seconds: null }
})}`

test('makeApiError keeps the historical message and attaches typed props', () => {
  const body = { detail: { ok: false, category: 'no_active_device', retry_after_seconds: null } }
  const error = makeApiError(404, JSON.stringify(body))

  assert.equal(error.message, `404: ${JSON.stringify(body)}`)
  assert.equal(error.statusCode, 404)
  assert.equal(error.status, 404)
  assert.equal(error.detail?.category, 'no_active_device')
  assert.equal(error.category, 'no_active_device')
  assert.deepEqual(error.body, body)
})

test('makeApiError falls back to status text for non-JSON bodies', () => {
  const error = makeApiError(502, 'Bad Gateway')

  assert.equal(error.message, '502: Bad Gateway')
  assert.equal(error.statusCode, 502)
  assert.equal(error.detail, undefined) // no body to preserve
})

// The regression test for the F2 incident: bridge error propagation.
test('F2 round trip: makeApiError → IPC strip → restoreApiError keeps detail.category', () => {
  const origin = makeApiError(404, JSON.stringify({
    detail: { ok: false, category: 'no_active_device', retry_after_seconds: null }
  }))

  const flattened = ipcStrip(origin) // what the renderer actually received in the QA run
  // The bug's mechanism: IPC leaves only .message (QA saw Object.keys(e) === []).
  assert.deepEqual(ownEnumerableProps(flattened), [])

  const restored = restoreApiError(flattened) as ApiError

  // What plugin apiCategory() reads — this is the recovery branch gate.
  assert.equal(restored.detail?.category, 'no_active_device')
  assert.equal(restored.category, 'no_active_device')
  assert.equal(restored.status, 404)
  assert.equal((restored.body?.detail as any).retry_after_seconds, null)
  assert.equal(restored.message, flattened.message) // message preserved verbatim
})

test('restoreApiError handles the exact QA-captured rejection string', () => {
  const restored = restoreApiError(new Error(QA_MESSAGE)) as ApiError

  assert.equal(restored.detail?.category, 'no_active_device')
  assert.equal(restored.status, 404)
})

test('restoreApiError maps retry_after_seconds from top level and detail', () => {
  const top = restoreApiError(new Error(`429: ${JSON.stringify({ category: 'rate_limited', retry_after_seconds: 37 })}`)) as ApiError
  assert.equal(top.retry_after_seconds, 37)

  const nested = restoreApiError(new Error(`429: ${JSON.stringify({ detail: { category: 'rate_limited', retry_after_seconds: 12 } })}`)) as ApiError
  assert.equal(nested.retry_after_seconds, 12)
  assert.equal(nested.detail?.category, 'rate_limited')
})

test('top-level category (no detail wrapper) restores too', () => {
  const restored = restoreApiError(new Error('403: {"category":"premium_required"}')) as ApiError

  assert.equal(restored.category, 'premium_required')
  assert.equal(restored.status, 403)
})

test('transport errors pass through with identity preserved', () => {
  const transport = new Error('Timed out connecting to Hermes backend after 8000ms')

  assert.equal(restoreApiError(transport), transport)
  assert.equal((restoreApiError(transport) as ApiError).detail, undefined)
})

test('non-Error rejections are wrapped, not lost', () => {
  const restored = restoreApiError('404: {"detail":{"category":"no_active_device"}}') as ApiError

  assert.ok(restored instanceof Error)
  assert.equal(restored.detail?.category, 'no_active_device')
})

test('restoreApiError returns non-matching non-Errors unchanged', () => {
  assert.equal(restoreApiError(undefined), undefined)
  assert.equal(restoreApiError(null), null)
  assert.equal(restoreApiError(42), 42)
})

test('parses the captured no_active_device rejection (parseFlattenedApiError)', () => {
  const parsed = parseFlattenedApiError(QA_MESSAGE)

  assert.ok(parsed)
  assert.equal(parsed.status, 404)
  assert.equal(parsed.body.detail?.category, 'no_active_device')
})

test('extracts status+body from a bare flattened message', () => {
  const parsed = parseFlattenedApiError('429: {"detail":{"category":"rate_limited","retry_after_seconds":37}}')

  assert.ok(parsed)
  assert.equal(parsed.status, 429)
  assert.equal(parsed.body.detail?.category, 'rate_limited')
  assert.equal(parsed.body.detail?.retry_after_seconds, 37)
})

test('port-like digit runs are not mistaken for status codes', () => {
  // 8080: the leading "808" is followed by '0', not ':', and "080" is
  // preceded by a digit — neither may match as the status of a JSON body.
  assert.equal(parseFlattenedApiError('connect ECONNREFUSED 127.0.0.1:8080: {}'), null)
})

test('non-JSON bodies return null', () => {
  assert.equal(parseFlattenedApiError('502: Bad Gateway'), null)
  assert.equal(parseFlattenedApiError('500: <html>oops</html>'), null)
  assert.equal(parseFlattenedApiError(''), null)
  assert.equal(parseFlattenedApiError('Hermes desktop bridge unavailable'), null)
})

test('JSON arrays are rejected (body must be an object)', () => {
  assert.equal(parseFlattenedApiError('200: [1,2,3]'), null)
})
