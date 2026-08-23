import assert from 'node:assert/strict'

import { test } from 'vitest'

// main.ts can't be imported (it boots Electron), so the scheme gate lives in a
// pure helper both main.ts and this test import. Behavior contract, not
// snapshot: web schemes pass, curated app schemes pass, everything else
// (file is handled earlier; javascript:, unknown:, hermes:) rejects.
import { isExternallyOpenableScheme } from './open-external-schemes'

test('web schemes are openable', () => {
  for (const scheme of ['http:', 'https:', 'mailto:']) {
    assert.equal(isExternallyOpenableScheme(scheme), true, scheme)
  }
})

test('curated app schemes are openable (PluginOs contract: spotify:)', () => {
  assert.equal(isExternallyOpenableScheme('spotify:'), true)
})

test('unknown and dangerous schemes are rejected', () => {
  for (const scheme of ['javascript:', 'unknown-scheme:', 'chrome:', 'file:', 'hermes:']) {
    assert.equal(isExternallyOpenableScheme(scheme), false, scheme)
  }
})

test('scheme comparison is case-insensitive', () => {
  assert.equal(isExternallyOpenableScheme('SPOTIFY:'), true)
  assert.equal(isExternallyOpenableScheme('JavaScript:'), false)
})
