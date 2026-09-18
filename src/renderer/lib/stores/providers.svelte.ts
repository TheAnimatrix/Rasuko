import type { ProviderCatalog, ProviderOption } from '@shared/settings'

export interface LoginEvent {
  type: string
  message?: string
  url?: string
  instructions?: string
  promptType?: 'text' | 'secret'
  placeholder?: string
  userCode?: string
  verificationUri?: string
  options?: Array<{ id: string; label: string; description?: string }>
  links?: Array<{ url: string; label?: string }>
}

class ProviderState {
  catalog = $state<ProviderCatalog | null>(null)
  loading = $state(false)
  loginSessionId = $state<string | null>(null)
  loginEvents = $state<LoginEvent[]>([])
  #unsubscribe: (() => void) | null = null

  get providers(): ProviderOption[] {
    return this.catalog?.providers ?? []
  }

  get configured(): ProviderOption[] {
    return this.providers.filter((p) => p.configured)
  }

  async load(): Promise<void> {
    this.loading = true
    try {
      this.catalog = await window.rasuko.providers.list()
    } finally {
      this.loading = false
    }
    if (!this.#unsubscribe) {
      this.#unsubscribe = window.rasuko.providers.onChanged((catalog) => {
        this.catalog = catalog
      })
      window.rasuko.providers.onLoginEvent(({ sessionId, event }) => {
        if (this.loginSessionId && sessionId !== this.loginSessionId) return
        this.loginEvents = [...this.loginEvents, event as LoginEvent]
        if (event.type === 'done' || event.type === 'error') {
          setTimeout(() => {
            this.loginSessionId = null
          }, 400)
        }
      })
    }
  }

  async setApiKey(providerId: string, key: string, baseUrl?: string): Promise<void> {
    await window.rasuko.providers.setApiKey(providerId, key, baseUrl)
    await this.load()
  }

  async logout(providerId: string): Promise<void> {
    await window.rasuko.providers.logout(providerId)
    await this.load()
  }

  async startLogin(providerId: string, type: 'api_key' | 'oauth'): Promise<void> {
    this.loginEvents = []
    this.loginSessionId = 'pending'
    const result =
      type === 'oauth'
        ? await window.rasuko.providers.loginOAuth(providerId)
        : await window.rasuko.providers.loginApiKey(providerId)
    if (!result.ok) {
      this.loginEvents = [...this.loginEvents, { type: 'error', message: result.error ?? 'Login failed' }]
      this.loginSessionId = null
    } else {
      await this.load()
    }
  }

  async respond(kind: 'prompt' | 'select' | 'manual_code' | 'cancel', value = ''): Promise<void> {
    const sessionId = this.loginSessionId
    if (!sessionId || sessionId === 'pending') return
    await window.rasuko.providers.respondLogin(sessionId, { kind, value } as never)
  }

  async cancelLogin(): Promise<void> {
    const sessionId = this.loginSessionId
    if (sessionId && sessionId !== 'pending') await window.rasuko.providers.cancelLogin(sessionId)
    this.loginSessionId = null
  }
}

export const providers = new ProviderState()
