import type { Api, Credential, Model, MutableModels } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { getEnvApiKey } from '@earendil-works/pi-ai/compat'
import type { ModelOption, ProviderCatalog, ProviderOption } from '@shared/settings'
import { getModelEffortLevels } from '@shared/modelEfforts'
import { newId } from '@shared/ids'
import { FileCredentialStore } from './CredentialStore'
import { LoginSession, type LoginEvent, type LoginResponse } from './LoginSession'
import { enhanceProvidersWithOpenAiCompatibleFetch } from './openAiCompatibleModelFetch'

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  google: 'Google',
  'google-vertex': 'Google Vertex',
  xai: 'Grok (xAI)',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  cerebras: 'Cerebras',
  together: 'Together',
  fireworks: 'Fireworks',
  nvidia: 'NVIDIA',
  huggingface: 'Hugging Face',
  'amazon-bedrock': 'Amazon Bedrock',
  azure: 'Azure OpenAI',
  opencode: 'OpenCode',
  ollama: 'Ollama'
}

const AMBIENT_PROVIDERS = new Set(['amazon-bedrock', 'google-vertex'])

export interface ProviderServiceEvents {
  onLoginEvent: (sessionId: string, event: LoginEvent) => void
  onChanged: (catalog: ProviderCatalog) => void
}

/**
 * Owns the pi-ai model catalog, credentials and login flows.
 * Runs in the Electron main process; secrets never cross the IPC boundary.
 */
export class ProviderService {
  private models: MutableModels
  private credentials: FileCredentialStore
  private sessions = new Map<string, LoginSession>()
  private refreshTimer: NodeJS.Timeout | null = null
  private initialized = false

  /** Assigned by the IPC layer so events can be broadcast to the renderer. */
  onLoginEvent: (sessionId: string, event: LoginEvent) => void = () => undefined
  onChanged: (catalog: ProviderCatalog) => void = () => undefined

  constructor() {
    this.credentials = new FileCredentialStore()
    this.models = builtinModels({ credentials: this.credentials })
    // Live `/v1/models` catalogs for OpenAI-compatible providers (OpenCode Zen,
    // OpenCode Go, OpenRouter, …) whose static catalog lags the service.
    enhanceProvidersWithOpenAiCompatibleFetch(this.models.getProviders())
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await this.refreshCatalog()
    this.refreshTimer = setInterval(() => {
      void this.refreshCatalog()
    }, 5 * 60 * 1000)
    this.refreshTimer.unref?.()
  }

  /** Refresh dynamic catalogs and publish the result to the renderer. */
  private async refreshCatalog(): Promise<void> {
    try {
      await this.models.refresh({ allowNetwork: true })
      this.onChanged(this.catalog())
    } catch {
      /* offline is fine — cached/static catalogs remain usable */
    }
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    for (const session of this.sessions.values()) session.cancel()
    this.sessions.clear()
  }

  isEncryptedAtRest(): boolean {
    return this.credentials.isEncryptedAtRest()
  }

  /* --------------------------------- catalog -------------------------------- */

  private configuredProviderIds(): Set<string> {
    return new Set(this.credentials.listProviderIdsSync())
  }

  catalog(): ProviderCatalog {
    const configured = this.configuredProviderIds()
    const providers: ProviderOption[] = []

    for (const provider of this.models.getProviders()) {
      let models: Model<Api>[] = []
      try {
        models = [...provider.getModels()]
      } catch {
        models = []
      }
      const hasOauth = Boolean(provider.auth?.oauth)
      const hasApiKey = Boolean(provider.auth?.apiKey)
      const ambient = AMBIENT_PROVIDERS.has(provider.id)
      providers.push({
        id: provider.id,
        label: PROVIDER_LABELS[provider.id] ?? provider.name ?? provider.id,
        models: models.map(toModelOption),
        authType: hasOauth && hasApiKey ? 'mixed' : hasOauth ? 'oauth' : ambient ? 'ambient' : 'api_key',
        // Ambient providers (Bedrock, Vertex) are only "configured" once the
        // user connects them — env credentials being present is not consent to
        // treat them as active providers.
        configured: configured.has(provider.id),
        description: provider.baseUrl,
        baseUrl: provider.baseUrl,
        customBaseUrl: provider.id === 'openai' || provider.id === 'openai-completions'
      })
    }

    // Custom OpenAI-compatible endpoint the user can point at any server.
    providers.push({
      id: 'custom-openai',
      label: 'OpenAI-compatible',
      models: [],
      authType: 'api_key',
      configured: configured.has('custom-openai'),
      description: 'Any server exposing /v1/models',
      customBaseUrl: true
    })

    providers.sort((a, b) => {
      if (a.configured !== b.configured) return a.configured ? -1 : 1
      return a.label.localeCompare(b.label)
    })

    return { providers, defaultProviderId: providers.find((p) => p.configured)?.id }
  }

  /* ---------------------------------- auth --------------------------------- */

  async setApiKey(providerId: string, apiKey: string, baseUrl?: string): Promise<void> {
    const key = apiKey.trim()
    if (!key) throw new Error('API key is required')
    await this.credentials.modify(providerId, async (current) => ({
      type: 'api_key',
      key,
      env: {
        ...(current && current.type === 'api_key' ? current.env : {}),
        ...(baseUrl ? { BASE_URL: baseUrl } : {})
      }
    }))
    await this.refreshQuietly()
    this.onChanged(this.catalog())
  }

  async verifyAmbient(providerId: string): Promise<{ ok: boolean; source?: string }> {
    const key = getEnvApiKey(providerId)
    if (!key) return { ok: false }
    await this.setApiKey(providerId, key)
    return { ok: true, source: providerId.toUpperCase().replace(/-/g, '_') + '_API_KEY' }
  }

  async logout(providerId: string): Promise<void> {
    await this.credentials.delete(providerId)
    this.onChanged(this.catalog())
  }

  async loginApiKey(providerId: string): Promise<{ ok: boolean; error?: string }> {
    if (AMBIENT_PROVIDERS.has(providerId)) {
      const detected = await this.verifyAmbient(providerId)
      return detected.ok
        ? { ok: true }
        : {
            ok: false,
            error: `${PROVIDER_LABELS[providerId] ?? providerId} credentials were not detected in the environment.`
          }
    }
    const session = this.createSession(providerId)
    try {
      const credential = await this.models.login(providerId, 'api_key', session.createAuthCallbacks())
      await this.persist(providerId, credential)
      session.finish()
      await this.refreshQuietly()
      this.onChanged(this.catalog())
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      session.fail(message)
      return { ok: false, error: message }
    } finally {
      this.sessions.delete(session.sessionId)
    }
  }

  async loginOAuth(providerId: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(providerId)
    try {
      const credential = await this.models.login(providerId, 'oauth', session.createAuthCallbacks())
      await this.persist(providerId, credential)
      session.finish()
      await this.refreshQuietly()
      this.onChanged(this.catalog())
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      session.fail(message)
      return { ok: false, error: message }
    } finally {
      this.sessions.delete(session.sessionId)
    }
  }

  respondLogin(sessionId: string, response: LoginResponse): void {
    this.sessions.get(sessionId)?.respond(response)
  }

  cancelLogin(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.cancel()
    this.sessions.delete(sessionId)
  }

  private createSession(providerId: string): LoginSession {
    const sessionId = newId('chat')
    const session = new LoginSession(sessionId, providerId, (event) => this.onLoginEvent(sessionId, event))
    this.sessions.set(sessionId, session)
    return session
  }

  private async persist(providerId: string, credential: Credential): Promise<void> {
    await this.credentials.modify(providerId, async () => credential)
  }

  private async refreshQuietly(): Promise<void> {
    try {
      await this.models.refresh({ allowNetwork: true })
    } catch {
      /* ignore */
    }
  }

  async discoverModels(providerId: string, baseUrl: string, apiKey: string): Promise<ModelOption[]> {
    const url = baseUrl.replace(/\/+$/, '').endsWith('/models')
      ? baseUrl.replace(/\/+$/, '')
      : `${baseUrl.replace(/\/+$/, '')}/models`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`Model discovery failed: HTTP ${response.status}`)
    const body = (await response.json()) as { data?: Array<{ id?: string; name?: string }> }
    return (body.data ?? [])
      .map((row) => ({
        id: typeof row.id === 'string' ? row.id : '',
        label: typeof row.name === 'string' && row.name ? row.name : humanize(row.id ?? '')
      }))
      .filter((m) => m.id)
  }

  /* ---------------------------------- stream -------------------------------- */

  resolveModel(providerId: string, modelId: string): Model<Api> | undefined {
    if (!providerId || !modelId) return undefined
    return this.models.getModel(providerId, modelId)
  }

  getModelsApi(): MutableModels {
    return this.models
  }
}

function toModelOption(model: Model<Api>): ModelOption {
  const efforts = getModelEffortLevels(model)
  return {
    id: model.id,
    label: model.name ?? humanize(model.id),
    contextWindow: (model as { contextWindow?: number }).contextWindow,
    ...(efforts && efforts.length > 0 ? { efforts } : {})
  }
}

function humanize(id: string): string {
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function createProviderService(): ProviderService {
  return new ProviderService()
}

