/* QA-HOLD F2 root-cause contract: the desktop IPC bridge flattens backend
 * error bodies (`404: {"detail":{"category":"no_active_device"...}}`) into
 * message-only Errors, so typed readers see nothing. apiCategory must parse
 * the flattened message; deviceUiState must not treat a missing error as
 * 'ready' (silent no-op defect). */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginPath = join(root, 'desktop', 'plugin.js')
const stubs = mkdtempSync(join(tmpdir(), 'spotify-f2hold-esm-'))
const stubUrl = name => pathToFileURL(join(stubs, name)).href
let failures = 0
const check = (ok, message) => { if (!ok) { failures += 1; console.error('FAIL: ' + message) } }

writeFileSync(join(stubs, 'sdk.mjs'), `export const ROUTES_AREA='routes'; export const SIDEBAR_NAV_AREA='sidebar.nav'; export const PALETTE_AREA='palette'; export const host={navigate(){}}; export const usePluginI18n=()=>({t:key=>key})`)
writeFileSync(join(stubs, 'react.mjs'), `export const useState=x=>[x,()=>{}]; export const useEffect=()=>undefined`)
writeFileSync(join(stubs, 'jsx.mjs'), `export const jsx=(type,props)=>({type,props:props||{}}); export const jsxs=jsx`)
writeFileSync(join(stubs, 'loader.mjs'), `const stubs=${JSON.stringify({'@hermes/plugin-sdk':stubUrl('sdk.mjs'),react:stubUrl('react.mjs'),'react/jsx-runtime':stubUrl('jsx.mjs')})}; const plugin=${JSON.stringify(pathToFileURL(pluginPath).href)}; export function resolve(s,c,n){return stubs[s]?{url:stubs[s],shortCircuit:true}:n(s,c)}; export async function load(u,c,n){const r=await n(u,c);return u===plugin?{format:'module',source:r.source,shortCircuit:true}:r}`)

try {
  register(pathToFileURL(join(stubs, 'loader.mjs')).href)
  const mod = await import(pathToFileURL(pluginPath).href + '?t=' + Date.now())
  const { apiCategory, deviceUiState } = mod

  // The EXACT rejection shape QA captured live in the bundle:
  // `Error invoking remote method 'hermes:api': Error: 404: {"detail":{...}}`
  const liveShape = new Error(`Error invoking remote method 'hermes:api': Error: 404: ${JSON.stringify({ detail: { ok: false, category: 'no_active_device', message: 'Player command failed: NO_ACTIVE_DEVICE' } })}`)
  check(apiCategory(liveShape) === 'no_active_device', 'apiCategory extracts no_active_device from the captured IPC-flattened message')

  // Typed fields still win when the new preload rehydrates them.
  check(apiCategory({ category: 'rate_limited' }) === 'rate_limited', 'typed top-level category still read first')
  check(apiCategory({ detail: { category: 'premium_required' } }) === 'premium_required', 'typed detail.category still read')
  check(apiCategory({ response: { category: 'restricted_device' } }) === 'restricted_device', 'typed response.category still read')

  // Flattened retry_after and rate_limit categories parse too.
  const rateLimited = new Error(`Error invoking remote method 'hermes:api': Error: 429: ${JSON.stringify({ detail: { category: 'rate_limited', retry_after_seconds: 37 } })}`)
  check(apiCategory(rateLimited) === 'rate_limited', 'flattened 429 rate_limited parses')

  // Non-matching shapes stay undefined — transport errors are not misread.
  check(apiCategory(new Error('Hermes desktop bridge unavailable')) === undefined, 'plain transport error yields no category')
  check(apiCategory(new Error('502: Bad Gateway')) === undefined, 'non-JSON status text yields no category')
  check(apiCategory(null) === undefined && apiCategory(undefined) === undefined, 'null/undefined yield no category')

  // deviceUiState: a missing error object must NOT read as 'ready' — that was
  // the silent-no-op half of the HOLD. It maps to 'unknown', so mutation-gated
  // controls stay disabled until a real signal exists.
  check(deviceUiState(undefined) === 'unknown', 'deviceUiState(undefined) is unknown, not ready')
  check(deviceUiState(null) === 'unknown', 'deviceUiState(null) is unknown, not ready')
  check(deviceUiState(new Error(`404: ${JSON.stringify({ detail: { category: 'no_active_device' } })}`)) === 'no_device', 'flattened no_active_device maps to no_device state')
  check(deviceUiState({ category: 'premium_required' }) === 'free_read_only', 'typed premium_required mapping intact')
} catch (error) {
  failures += 1
  console.error('IMPORT/THROW: ' + (error && error.stack || error))
}

rmSync(stubs, { recursive: true, force: true })
if (failures) { console.error(`${failures} failure(s)`); process.exit(1) }
console.log('ipc-flattened-error-contract: all checks passed')
