/**
 * Dynamic model listing for OpenAI-compatible `/v1/models` endpoints via
 * pi-ai `Models.refresh`. Merges remote IDs into the static catalog using a
 * template model from the provider baseline.
 *
 * Ported from Mousse: several providers (notably `opencode-go` and
 * `opencode`) serve a catalog that changes faster than pi-ai ships releases —
 * the static data file lags behind what the account can actually use, so the
 * live list is what the model picker must show.
 */
import type { Api, Model, Provider } from '@earendil-works/pi-ai'

const OPENAI_COMPAT_PROVIDER_IDS = new Set([
  'openai',
  'openrouter',
  'groq',
  'cerebras',
  'xai',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'nvidia',
  'huggingface',
  'opencode',
  'opencode-go',
  'vercel-ai-gateway',
  'custom-openai'
])

function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/models')) return trimmed
  return `${trimmed}/models`
}

function humanizeModelId(id: string): string {
  const leaf = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function asModelTemplate(template: Model<Api>, id: string, name?: string): Model<Api> {
  return {
    ...template,
    id,
    name: name?.trim() || humanizeModelId(id)
  }
}

/**
 * A provider can host several APIs with different base URLs (opencode-go uses
 * `…/zen/go` for Anthropic-style models and `…/zen/go/v1` for OpenAI-style
 * ones). Only the OpenAI-compatible base URL exposes `/models`, so pick
 * candidates that are most likely to answer instead of blindly trusting the
 * first model in the catalog.
 */
function modelListCandidates(models: Model<Api>[]): Model<Api>[] {
  const seen = new Set<string>()
  const candidates = models.filter((model) => {
    if (!model.baseUrl || seen.has(model.baseUrl)) return false
    seen.add(model.baseUrl)
    return true
  })
  const rank = (model: Model<Api>): number => {
    const openAiApi = model.api === 'openai-completions' || model.api === 'openai-responses'
    const v1 = /\/v\d+(\/)?$/.test(model.baseUrl ?? '')
    return (openAiApi ? 0 : 2) + (v1 ? 0 : 1)
  }
  return [...candidates].sort((a, b) => rank(a) - rank(b))
}

export async function fetchOpenAiCompatibleModelList(options: {
  baseUrl: string
  apiKey: string
  providerId: string
  template: Model<Api>
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<Model<Api>[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) return [options.template]

  const response = await fetchImpl(modelsUrl(options.baseUrl), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/json'
    },
    signal: options.signal
  })
  if (!response.ok) {
    throw new Error(`Model list HTTP ${response.status} for ${options.providerId}`)
  }
  const body = (await response.json()) as { data?: Array<{ id?: string; name?: string }> }
  const rows = Array.isArray(body.data) ? body.data : []
  const out: Model<Api>[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(asModelTemplate(options.template, id, typeof row.name === 'string' ? row.name : undefined))
  }
  return out.length > 0 ? out : [options.template]
}

/**
 * Attach `refreshModels` to OpenAI-compatible providers that lack one, so
 * `Models.refresh()` can pull live catalogs when credentials exist.
 */
export function enhanceProvidersWithOpenAiCompatibleFetch(providers: readonly Provider[]): void {
  for (const provider of providers) {
    if (!OPENAI_COMPAT_PROVIDER_IDS.has(provider.id)) continue
    if (provider.refreshModels) continue

    const baseline = (): Model<Api>[] => {
      try {
        return provider.getModels() as Model<Api>[]
      } catch {
        return []
      }
    }

    let dynamic: Model<Api>[] | undefined

    const originalGet = provider.getModels.bind(provider)
    provider.getModels = () => {
      if (dynamic && dynamic.length > 0) return dynamic
      return originalGet()
    }

    provider.refreshModels = async (context) => {
      if (context.stored?.models?.length) {
        dynamic = context.stored.models.filter((model) => model.provider === provider.id) as Model<Api>[]
      }
      if (!context.allowNetwork || context.signal.aborted) return

      const templates = baseline()
      const candidates = modelListCandidates(templates)
      if (candidates.length === 0) return

      const apiKey =
        context.credential?.type === 'api_key'
          ? context.credential.key
          : context.credential?.type === 'oauth'
            ? context.credential.access
            : undefined
      if (!apiKey) return

      for (const template of candidates) {
        if (context.signal.aborted) return
        try {
          const refreshed = await fetchOpenAiCompatibleModelList({
            baseUrl: template.baseUrl ?? '',
            apiKey,
            providerId: provider.id,
            template,
            signal: context.signal
          })
          // Keep the catalog's richer metadata (display names, thinking maps)
          // for ids we already know, and append the ids only the live endpoint
          // advertises — those are the models that shipped after this release.
          const byId = new Map(templates.map((model) => [model.id, model]))
          for (const model of refreshed) {
            if (!byId.has(model.id)) byId.set(model.id, model)
          }
          dynamic = Array.from(byId.values())
          await context.publish({ persist: { models: dynamic, checkedAt: Date.now() } })
          return
        } catch {
          // Try the next candidate base URL; keep baseline on total failure.
        }
      }
    }
  }
}
