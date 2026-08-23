// Pure scheme gate for openExternalUrl (main.ts) — extracted so the plugin-facing
// contract (PluginOs.openExternal: "custom schemes like `spotify:`") is testable
// without importing Electron. main.ts owns the curated app-scheme list.
export const WEB_URL_SCHEMES = ['http:', 'https:', 'mailto:'] as const

// Keep alphabetical. hermes:// is deliberately absent: it belongs to the app's
// own deep-link router, never the OS shell.
export const APP_URL_SCHEMES = ['spotify:', 'zoom:'] as const

const OPENABLE = new Set<string>(
  [...WEB_URL_SCHEMES, ...APP_URL_SCHEMES].map(scheme => scheme.toLowerCase())
)

export function isExternallyOpenableScheme(protocol: string): boolean {
  return OPENABLE.has(String(protocol || '').toLowerCase())
}
