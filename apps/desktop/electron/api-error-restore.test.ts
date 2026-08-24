import assert from 'node:assert/strict'

import { test } from 'vitest'

import { parseFlattenedApiError } from './api-error-restore'

// Contract: the exact shape QA captured on the live rejection —
// `404: {"detail":{"ok":false,"category":"no_active_device",...}}` — must parse
// back into a typed body so the renderer/plugin layer can read .detail.category
// again. Non-matching messages must stay null (transport errors untouched).
test('parses the captured no_active_device IPC rejection', () => {
  const msg = `Error invoking remote method 'hermes:api': Error: 404: ${JSON.stringify({
    detail: { ok: false, category: 'no_active_device' }
  })}`

  // The prefix before the status code must be tolerated: strip to the pattern.
  const stripped = msg.slice(msg.indexOf('404:'))
  const parsed = parseFlattenedApiError(stripped)

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

test('top-level category (no detail wrapper) parses too', () => {
  const parsed = parseFlattenedApiError('403: {"category":"premium_required"}')

  assert.ok(parsed)
  assert.equal(parsed.body.category, 'premium_required')
})

test('non-JSON bodies return null', () => {
  assert.equal(parseFlattenedApiError('502: Bad Gateway'), null)
  assert.equal(parseFlattenedApiError('500: <html>oops</html>'), null)
})

test('non-error strings and empty input return null', () => {
  assert.equal(parseFlattenedApiError('Hermes desktop bridge unavailable'), null)
  assert.equal(parseFlattenedApiError(''), null)
})

test('JSON arrays are rejected (body must be an object)', () => {
  assert.equal(parseFlattenedApiError('200: [1,2,3]'), null)
})
