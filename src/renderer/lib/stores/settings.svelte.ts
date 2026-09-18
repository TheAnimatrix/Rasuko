import type { RasukoSettings, RasukoSettingsUpdate } from '@shared/settings'

/**
 * Settings mirror. The main process is the source of truth; this store keeps a
 * reactive copy and writes through.
 */
class SettingsState {
  value = $state<RasukoSettings | null>(null)
  saving = $state(false)
  error = $state<string | null>(null)
  #unsubscribe: (() => void) | null = null

  async load(): Promise<void> {
    this.value = await window.rasuko.settings.get()
    if (!this.#unsubscribe) {
      this.#unsubscribe = window.rasuko.settings.onChanged((next) => {
        this.value = next
      })
    }
  }

  async update(patch: RasukoSettingsUpdate): Promise<void> {
    this.saving = true
    this.error = null
    try {
      this.value = await window.rasuko.settings.set(patch)
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save settings'
    } finally {
      this.saving = false
    }
  }
}

export const settingsStore = new SettingsState()

export function t(): RasukoSettings {
  if (!settingsStore.value) throw new Error('Settings not loaded')
  return settingsStore.value
}

export async function initSettings(): Promise<void> {
  await settingsStore.load()
}

export async function updateSettings(patch: RasukoSettingsUpdate): Promise<void> {
  await settingsStore.update(patch)
}
