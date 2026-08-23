/* F1/F2 UI repair contract: input contrast (::placeholder needs a <style> tag,
 * not inline styles) and no_active_device play recovery (open spotify:, bounded
 * 20s /devices poll, transfer, single retry) with an honest Opening Spotify…
 * button state. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginPath = join(root, 'desktop', 'plugin.js')
const stubs = mkdtempSync(join(tmpdir(), 'spotify-f1f2-esm-'))
const stubUrl = name => pathToFileURL(join(stubs, name)).href
let failures = 0
const check = (ok, message) => { if (!ok) { failures += 1; console.error('FAIL: ' + message) } }

writeFileSync(join(stubs, 'sdk.mjs'), `export const ROUTES_AREA='routes'; export const SIDEBAR_NAV_AREA='sidebar.nav'; export const PALETTE_AREA='palette'; export const host={navigate(){}}; export const usePluginI18n=()=>({t:key=>key})`)
writeFileSync(join(stubs, 'react.mjs'), `export const useState=x=>[x,()=>{}]; export const useEffect=()=>undefined`)
writeFileSync(join(stubs, 'jsx.mjs'), `export const jsx=(type,props)=>({type,props:props||{}}); export const jsxs=jsx`)
writeFileSync(join(stubs, 'loader.mjs'), `const stubs=${JSON.stringify({'@hermes/plugin-sdk':stubUrl('sdk.mjs'),react:stubUrl('react.mjs'),'react/jsx-runtime':stubUrl('jsx.mjs')})}; const plugin=${JSON.stringify(pathToFileURL(pluginPath).href)}; export function resolve(s,c,n){return stubs[s]?{url:stubs[s],shortCircuit:true}:n(s,c)}; export async function load(u,c,n){const r=await n(u,c);return u===plugin?{format:'module',source:r.source,shortCircuit:true}:r}`)

try {
  const source = readFileSync(pluginPath, 'utf8')
  register(pathToFileURL(join(stubs, 'loader.mjs')).href)
  const mod = await import(pathToFileURL(pluginPath).href + '?t=' + Date.now())
  const { playWithDeviceRecovery, recoverNoDevice } = mod

  // ---- F1: input contrast ------------------------------------------------
  check(source.includes("className: 'spotify-input'") && source.includes('var INPUT_STYLE_ID'), 'text inputs carry the spotify-input class styled by the injected sheet')
  check(/inputText:.*color: 'var\(--ui-text-primary\)'/s.test(source), 'shared input style pins --ui-text-primary text color')
  check(source.includes('.spotify-input::placeholder { color: var(--ui-text-tertiary); opacity: 1; }'), 'placeholder color targets ui-text-tertiary through a style tag (inline styles cannot hit ::placeholder)')
  check(source.includes('function ensureInputStyles()') && source.includes('document.getElementById(INPUT_STYLE_ID)'), 'style injection is idempotent (skips when the tag already exists)')
  check(source.includes('useEffect(ensureInputStyles, [])'), 'page mount injects the placeholder style sheet exactly once')
  var inputCount = (source.match(/className: 'spotify-input'/g) || []).length
  check(inputCount === 3, 'all three text inputs (search, rename, create) use the styled class — got ' + inputCount)

  // ---- F2: no_active_device recovery -------------------------------------
  check(source.includes("osRef.openExternal('spotify:')"), 'recovery opens the curated spotify: scheme through PluginOs.openExternal')

  // Behavioral: happy path — play fails no_active_device once, recovery
  // returns a device, transfer fires, play retried exactly once, playback
  // refetched. Verifies call ORDER and retry count, not just presence.
  {
    const calls = []
    const rest = (path, opts) => {
      calls.push(path + ' ' + (opts && opts.method))
      if (path === '/playback/play') {
        if (calls.filter(c => c === '/playback/play POST').length === 1) { const e = new Error('no device'); e.category = 'no_active_device'; return Promise.reject(e) }
        return Promise.resolve({ ok: true })
      }
      if (path === '/devices') return Promise.resolve({ devices: [{ id: 'device-1', can_transfer: true }] })
      if (path === '/transfer') return Promise.resolve({ ok: true })
      if (path === '/playback') return Promise.resolve({ ok: true, item: { id: 't' } })
      return Promise.resolve({ ok: true })
    }
    const opened = []
    const os = { openExternal: url => { opened.push(url); return Promise.resolve() } }
    mod.default.register({ rest, os, registerMany: () => {}, onDispose: () => {} })
    const statuses = []
    await playWithDeviceRecovery({ uris: ['spotify:track:x'] }, s => statuses.push(s))
    check(opened[0] === 'spotify:', 'recovery opened the spotify: scheme once')
    check(statuses[0] === 'opening', 'button enters Opening Spotify… state during recovery')
    check(calls.filter(c => c === '/playback/play POST').length === 2, 'play retried exactly once after transfer')
    check(calls.includes('/devices GET') && calls.includes('/transfer POST'), 'recovery polls devices and transfers playback')
    check(calls[calls.length - 1] === '/playback GET', 'playback state refetched after successful retry')
    mod.default.register({ rest: () => Promise.reject(new Error('gone')), os: { openExternal: () => Promise.reject(new Error('no')) }, registerMany: () => {}, onDispose: () => {} })
  }

  // Behavioral: bounded poll — device never appears, recovery gives up at the
  // deadline instead of polling forever, and play surfaces the typed failure.
  {
    const opened = []
    const rest = (path) => path === '/devices' ? Promise.resolve({ devices: [] }) : Promise.resolve({ ok: true })
    mod.default.register({ rest, os: { openExternal: url => { opened.push(url); return Promise.resolve() } }, registerMany: () => {}, onDispose: () => {} })
    const polls = []
    const realRest = rest
    // wrap to count polls
    mod.default.register({ rest: (path, opts) => { if (path === '/devices') polls.push(1); return realRest(path, opts) }, os: { openExternal: () => Promise.resolve() }, registerMany: () => {}, onDispose: () => {} })
    const start = Date.now()
    let surfaced = null
    try { await recoverNoDevice({ waitMs: 50, pollMs: 10 }) } catch (error) { surfaced = error }
    check(Date.now() - start < 2000, 'bounded wait gives up near the deadline (no infinite poll)')
    check(polls.length >= 2 && polls.length <= 12, 'poll cadence respected during bounded wait — got ' + polls.length + ' polls')
    check(surfaced === null, 'recovery resolves null (typed no-device state) instead of throwing')
  }

  // Behavioral: non-device failures never trigger recovery.
  {
    let openedCalled = false
    const rest = (path) => { if (path === '/playback/play') { const e = new Error('premium'); e.category = 'premium_required'; return Promise.reject(e) } return Promise.resolve({}) }
    mod.default.register({ rest, os: { openExternal: () => { openedCalled = true; return Promise.resolve() } }, registerMany: () => {}, onDispose: () => {} })
    let failed = null
    try { await playWithDeviceRecovery({ uris: ['spotify:track:y'] }, () => {}) } catch (error) { failed = error }
    check(failed && failed.category === 'premium_required', 'premium failure propagates without recovery attempt')
    check(!openedCalled, 'spotify: scheme never opened for non-device failures')
  }

  check(source.includes("'Opening Spotify…'"), 'buttons surface the Opening Spotify… state')
  check(source.includes("status === 'opening' || blocked"), 'opening state keeps the play button disabled')
} finally { rmSync(stubs, { recursive: true, force: true }) }

console.log(failures === 0 ? 'PASS: spotify F1 input contrast + F2 no-device recovery contract' : 'FAILURES: ' + failures)
process.exit(failures ? 1 : 0)
