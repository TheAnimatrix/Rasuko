import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  deepMerge,
  type RasukoSettings,
  type RasukoSettingsUpdate
} from '@shared/settings'
import { settingsPath } from '../paths'
import { atomicWriteJsonSync, readJsonSync } from '../io/atomic'

export class SettingsStore {
  private cache: RasukoSettings | null = null

  constructor(private readonly path: string = settingsPath()) {}

  get(): RasukoSettings {
    if (this.cache) return this.cache
    const stored = readJsonSync<Partial<RasukoSettings>>(this.path)
    this.cache = stored ? normalizeSettings(stored) : { ...DEFAULT_SETTINGS }
    return this.cache
  }

  set(partial: RasukoSettingsUpdate): RasukoSettings {
    const merged = normalizeSettings(deepMerge(this.get(), partial))
    this.cache = merged
    atomicWriteJsonSync(this.path, merged, { mode: 0o600 })
    return merged
  }

  defaults(): RasukoSettings {
    return { ...DEFAULT_SETTINGS }
  }
}
