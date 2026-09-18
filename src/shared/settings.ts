/**
 * Settings schema + defaults. Stored at `~/.rasuko/rasuko.conf` as JSON.
 * Credentials are separate (`auth.json`, safeStorage-encrypted).
 */

export const SETTINGS_VERSION = 1

export type ThemeId = 'light' | 'dark' | 'system'

export interface ProviderSettings {
  providerId: string
  model: string
  /** Optional reasoning effort hint, passed through to pi-ai. */
  effort?: string
  /** For OpenAI-compatible endpoints. */
  baseUrl?: string
}

export interface RasukoSettings {
  version: number
  appearance: {
    theme: ThemeId
    accent: string
    fontScale: number
    density: 'comfortable' | 'compact'
  }
  editor: {
    /** Markdown *input* mode. Storage is never markdown. */
    markdown: boolean
    spellcheck: boolean
    font: 'sans' | 'serif' | 'mono'
    contentWidth: 'narrow' | 'default' | 'wide' | 'full'
    showBlockHandles: boolean
  }
  assistant: {
    /** Main model used for chat + View redesign. */
    model: ProviderSettings
    /** Model used for cheap jobs (titles, small summaries). */
    utilityModel: ProviderSettings
    autoApplyViewOps: boolean
    showThinking: boolean
    temperature: number
  }
  workspace: {
    /** Create a starter page on first launch. */
    seeding: boolean
    confirmDelete: boolean
  }
  window: {
    sidebarWidth: number
    assistantWidth: number
    sidebarCollapsed: boolean
    assistantCollapsed: boolean
  }
  recentModels: string[]
}

export const DEFAULT_SETTINGS: RasukoSettings = {
  version: SETTINGS_VERSION,
  appearance: {
    theme: 'system',
    accent: '#6d5bd0',
    fontScale: 1,
    density: 'comfortable'
  },
  editor: {
    markdown: false,
    spellcheck: true,
    font: 'sans',
    contentWidth: 'default',
    showBlockHandles: true
  },
  assistant: {
    model: { providerId: '', model: '' },
    utilityModel: { providerId: '', model: '' },
    autoApplyViewOps: false,
    showThinking: true,
    temperature: 0.4
  },
  workspace: {
    seeding: true,
    confirmDelete: true
  },
  window: {
    sidebarWidth: 248,
    assistantWidth: 360,
    sidebarCollapsed: false,
    assistantCollapsed: true
  },
  recentModels: []
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<U>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

export type RasukoSettingsUpdate = DeepPartial<RasukoSettings>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  if (!isPlainObject(base)) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = out[key]
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value
  }
  return out as T
}

const THEMES: ThemeId[] = ['light', 'dark', 'system']

export function normalizeSettings(raw: unknown): RasukoSettings {
  const merged = deepMerge(DEFAULT_SETTINGS, raw)
  if (!THEMES.includes(merged.appearance.theme)) merged.appearance.theme = 'system'
  if (!/^#[0-9a-f]{6}$/i.test(merged.appearance.accent)) merged.appearance.accent = DEFAULT_SETTINGS.appearance.accent
  merged.appearance.fontScale = clamp(Number(merged.appearance.fontScale) || 1, 0.8, 1.4)
  merged.assistant.temperature = clamp(Number(merged.assistant.temperature) ?? 0.4, 0, 1.5)
  merged.window.sidebarWidth = clamp(Number(merged.window.sidebarWidth) || 248, 180, 520)
  merged.window.assistantWidth = clamp(Number(merged.window.assistantWidth) || 360, 280, 720)
  merged.version = SETTINGS_VERSION
  if (!Array.isArray(merged.recentModels)) merged.recentModels = []
  merged.recentModels = merged.recentModels.filter((m): m is string => typeof m === 'string').slice(0, 12)
  return merged
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/* ------------------------------------------------------------------ *
 * Provider catalog shapes shared with the renderer
 * ------------------------------------------------------------------ */

export interface ModelOption {
  id: string
  label: string
  contextWindow?: number
  efforts?: string[]
}

export interface ProviderOption {
  id: string
  label: string
  models: ModelOption[]
  authType: 'api_key' | 'oauth' | 'ambient' | 'mixed'
  configured: boolean
  description?: string
  baseUrl?: string
  /** Provider accepts a user-supplied base URL. */
  customBaseUrl?: boolean
}

export interface ProviderCatalog {
  providers: ProviderOption[]
  defaultProviderId?: string
}
