<script lang="ts">
  /**
   * Settings — a single overlay-style page (not a routed sub-tree).
   *
   * Every control writes through `updateSettings` or the provider store; the
   * local `settings` value is read-only and always mirrors the main process.
   */

  import { onMount, tick } from 'svelte'
  import type { Snippet } from 'svelte'
  import { DEFAULT_SETTINGS } from '@shared/settings'
  import type { ModelOption, ProviderOption, RasukoSettings } from '@shared/settings'
  import { settingsStore, updateSettings } from '$lib/stores/settings.svelte'
  import { providers } from '$lib/stores/providers.svelte'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { navigate } from '$lib/router'
  import { cn, debounce } from '$lib/utils'
  import { ICONS } from '$lib/icon-names'
  import Icon from '$lib/components/Icon.svelte'
  import IconButton from '$lib/components/ui/IconButton.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Input from '$lib/components/ui/Input.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import Switch from '$lib/components/ui/Switch.svelte'
  import Badge from '$lib/components/ui/Badge.svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
  import Spinner from '$lib/components/ui/Spinner.svelte'
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import ModelFamilySelector from '$lib/components/ModelFamilySelector.svelte'

  type SectionId = 'appearance' | 'editor' | 'assistant' | 'providers' | 'workspace' | 'about'
  type EditorFont = RasukoSettings['editor']['font']

  interface AppInfo {
    name: string
    version: string
    platform: string
    encryptedCredentials: boolean
    home: string
  }

  const SECTIONS: { id: SectionId; label: string; icon: string; description: string }[] = [
    { id: 'appearance', label: 'Appearance', icon: ICONS.palette, description: 'Theme, accent and reading scale.' },
    { id: 'editor', label: 'Editor', icon: ICONS.page, description: 'How writing behaves.' },
    { id: 'assistant', label: 'Assistant', icon: ICONS.sparkles, description: 'Models and behaviour.' },
    { id: 'providers', label: 'Providers', icon: ICONS.plug, description: 'Connect model providers.' },
    { id: 'workspace', label: 'Workspace', icon: ICONS.layers, description: 'Files and destructive actions.' },
    { id: 'about', label: 'About', icon: ICONS.info, description: 'Version and storage.' }
  ]

  const THEME_OPTIONS = [
    { value: 'system' as const, label: 'System', icon: ICONS.monitor },
    { value: 'light' as const, label: 'Light', icon: ICONS.sun },
    { value: 'dark' as const, label: 'Dark', icon: ICONS.moon }
  ]

  const DENSITY_OPTIONS = [
    { value: 'comfortable' as const, label: 'Comfortable' },
    { value: 'compact' as const, label: 'Compact' }
  ]

  const ACCENTS = ['#6d5bd0', '#5b8def', '#2fa36b', '#d97706', '#e05263', '#0ea5e9', '#a855f7', '#111827']

  const FONT_OPTIONS = [
    { value: 'sans', label: 'Sans' },
    { value: 'serif', label: 'Serif' },
    { value: 'mono', label: 'Mono' }
  ]

  const WIDTH_OPTIONS = [
    { value: 'narrow', label: 'Narrow' },
    { value: 'default', label: 'Default' },
    { value: 'wide', label: 'Wide' },
    { value: 'full', label: 'Full' }
  ]

  let section = $state<SectionId>('appearance')
  let appInfo = $state<AppInfo | null>(null)

  /* ------------------------------- appearance ------------------------------ */
  let fontScaleDraft = $state(1)

  /* ------------------------------- assistant ------------------------------- */
  let temperatureDraft = $state(0.4)
  let testState = $state<'idle' | 'running' | 'success' | 'error'>('idle')
  let testMessage = $state('')

  /* ------------------------------- providers ------------------------------- */
  let addingProvider = $state(false)
  let addStep = $state<'pick' | 'credentials'>('pick')
  let providerQuery = $state('')
  let providerFilter = $state<'all' | 'api_key' | 'oauth'>('all')
  let selectedProviderId = $state<string | null>(null)
  let apiKey = $state('')
  let baseUrl = $state('')
  let discovered = $state<ModelOption[]>([])
  let discovering = $state(false)
  let connecting = $state(false)
  let connectError = $state<string | null>(null)
  let showKey = $state(false)
  let removeOpen = $state(false)
  let removeTarget = $state<ProviderOption | null>(null)

  /* ------------------------------ login modal ------------------------------ */
  let loginOpen = $state(false)
  let promptValue = $state('')
  let manualCode = $state('')

  /* ------------------------------- workspace ------------------------------- */
  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  /* --------------------------------- derived ------------------------------- */
  const settings = $derived(settingsStore.value ?? DEFAULT_SETTINGS)
  const configured = $derived(providers.configured)

  const mainProvider = $derived(providers.providers.find((p) => p.id === settings.assistant?.model.providerId) ?? null)
  const mainProviderOptions = $derived(configured.map((p) => ({ value: p.id, label: p.label })))

  const utilityProviderOptions = $derived([
    { value: '', label: 'None — reuse the main model' },
    ...configured.map((p) => ({ value: p.id, label: p.label }))
  ])

  const filteredProviders = $derived.by(() => {
    const query = providerQuery.trim().toLowerCase()
    return providers.providers.filter((provider) => {
      if (providerFilter === 'api_key' && provider.authType !== 'api_key' && provider.authType !== 'ambient') return false
      if (providerFilter === 'oauth' && provider.authType !== 'oauth' && provider.authType !== 'mixed') return false
      if (query && !provider.label.toLowerCase().includes(query)) return false
      return true
    })
  })

  const selectedProvider = $derived(providers.providers.find((p) => p.id === selectedProviderId) ?? null)

  const canTest = $derived(Boolean(workspace.activePageId) && configured.length > 0)
  const testHint = $derived(
    !workspace.activePageId ? 'Open a page first' : configured.length === 0 ? 'Connect a provider first' : ''
  )

  // NOTE: `providers.loginSessionId` is briefly the literal string 'pending'
  // before the real session id arrives, and the store's `respond()` refuses to
  // act while it is 'pending'. We only enable in-dialog submissions once a real
  // id exists. (Maintainer TODO: have the store publish the real id immediately
  // instead of 'pending' so this guard can be removed.)
  const loginReady = $derived(providers.loginSessionId !== null && providers.loginSessionId !== 'pending')

  onMount(() => {
    if (!providers.catalog) void providers.load()
    void window.rasuko.app.info().then((info) => (appInfo = info))
  })

  $effect(() => {
    const value = settingsStore.value
    if (!value) return
    fontScaleDraft = value.appearance.fontScale
    temperatureDraft = value.assistant.temperature
  })

  $effect(() => {
    loginOpen = providers.loginSessionId !== null
  })

  /* -------------------------------- helpers -------------------------------- */
  const commitAccent = debounce(
    (value: string) => void updateSettings({ appearance: { accent: value } }),
    120
  )

  function setTheme(theme: RasukoSettings['appearance']['theme']): void {
    void updateSettings({ appearance: { theme } })
  }

  function setDensity(density: RasukoSettings['appearance']['density']): void {
    void updateSettings({ appearance: { density } })
  }

  function setName<K extends 'main' | 'utility'>(kind: K, providerId: string): void {
    if (kind === 'main') {
      if (!providerId) return
      const provider = providers.providers.find((p) => p.id === providerId)
      void updateSettings({ assistant: { model: { providerId, model: provider?.models[0]?.id ?? '' } } })
      return
    }
    if (!providerId) {
      void updateSettings({ assistant: { utilityModel: { providerId: '', model: '' } } })
      return
    }
    const provider = providers.providers.find((p) => p.id === providerId)
    void updateSettings({ assistant: { utilityModel: { providerId, model: provider?.models[0]?.id ?? '' } } })
  }

  function setUtilityModel(): void {
    const provider = mainProvider ?? configured[0]
    if (!provider) return
    void updateSettings({
      assistant: { utilityModel: { providerId: provider.id, model: provider.models[0]?.id ?? '' } }
    })
  }

  async function testConnection(): Promise<void> {
    const pageId = workspace.activePageId
    if (!pageId || configured.length === 0 || testState === 'running') return
    testState = 'running'
    testMessage = ''
    try {
      const message = await window.rasuko.chat.send({
        pageId,
        text: 'Reply with the single word: ready',
        mode: 'chat'
      })
      testState = 'success'
      testMessage = message.text?.trim().slice(0, 40) || 'Ready'
    } catch (error) {
      testState = 'error'
      testMessage = error instanceof Error ? error.message : 'No reply'
    }
  }

  function authLabel(auth: ProviderOption['authType']): string {
    if (auth === 'api_key') return 'API key'
    if (auth === 'ambient') return 'Env'
    return 'Subscription'
  }

  function authTone(auth: ProviderOption['authType']): 'neutral' | 'info' | 'success' | 'warning' {
    if (auth === 'api_key') return 'info'
    if (auth === 'ambient') return 'warning'
    return 'neutral'
  }

  function toggleAddProvider(): void {
    addingProvider = !addingProvider
    addStep = 'pick'
    selectedProviderId = null
    connectError = null
  }

  function chooseProvider(provider: ProviderOption): void {
    selectedProviderId = provider.id
    apiKey = ''
    baseUrl = provider.baseUrl ?? ''
    discovered = []
    connectError = null
    showKey = false
    addStep = 'credentials'
  }

  function backToPick(): void {
    selectedProviderId = null
    connectError = null
    discovered = []
    addStep = 'pick'
  }

  async function discover(): Promise<void> {
    const provider = selectedProvider
    if (!provider) return
    discovering = true
    connectError = null
    discovered = []
    try {
      discovered = await window.rasuko.providers.discoverModels(baseUrl, apiKey, provider.id)
    } catch (error) {
      connectError = error instanceof Error ? error.message : 'Could not reach the endpoint'
    } finally {
      discovering = false
    }
  }

  async function connectWithKey(): Promise<void> {
    const provider = selectedProvider
    if (!provider) return
    connecting = true
    connectError = null
    try {
      if (provider.customBaseUrl) await providers.setApiKey(provider.id, apiKey, baseUrl)
      else await providers.setApiKey(provider.id, apiKey)
      addingProvider = false
      addStep = 'pick'
      selectedProviderId = null
    } catch (error) {
      connectError = error instanceof Error ? error.message : 'Could not save credentials'
    } finally {
      connecting = false
    }
  }

  function connectSubscription(): void {
    const provider = selectedProvider
    if (!provider) return
    void providers.startLogin(provider.id, 'oauth')
  }

  async function detectAmbient(): Promise<void> {
    const provider = selectedProvider
    if (!provider) return
    connecting = true
    connectError = null
    try {
      const result = await window.rasuko.providers.loginApiKey(provider.id)
      if (!result.ok) connectError = result.error ?? 'No key found in the environment'
      else {
        await providers.load()
        addingProvider = false
        addStep = 'pick'
        selectedProviderId = null
      }
    } catch (error) {
      connectError = error instanceof Error ? error.message : 'Could not detect a key'
    } finally {
      connecting = false
    }
  }

  function askRemove(provider: ProviderOption): void {
    removeTarget = provider
    removeOpen = true
  }

  async function confirmRemove(): Promise<void> {
    if (removeTarget) await providers.logout(removeTarget.id)
    removeOpen = false
    removeTarget = null
  }

  async function respondPrompt(): Promise<void> {
    if (!loginReady) return
    const value = promptValue
    promptValue = ''
    await providers.respond('prompt', value)
  }

  async function respondManual(): Promise<void> {
    if (!loginReady) return
    const value = manualCode
    manualCode = ''
    await providers.respond('manual_code', value)
  }

  async function respondSelect(id: string): Promise<void> {
    if (!loginReady) return
    await providers.respond('select', id)
  }

  async function openWorkspaceFolder(): Promise<void> {
    const info = appInfo ?? (await window.rasuko.app.info())
    appInfo = info
    try {
      await navigator.clipboard.writeText(info.home)
    } catch {
      // Clipboard access can be denied; the path is still shown.
    }
    copied = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied = false), 1600)
  }

  async function onNavKeydown(event: KeyboardEvent): Promise<void> {
    const current = SECTIONS.findIndex((item) => item.id === section)
    let next = -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % SECTIONS.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current - 1 + SECTIONS.length) % SECTIONS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = SECTIONS.length - 1
    if (next < 0) return
    event.preventDefault()
    section = SECTIONS[next].id
    await tick()
    ;(event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-active="true"]')?.focus()
  }
</script>

{#snippet SectionHeading(icon: string, title: string, description: string)}
  <div class="mb-3 flex items-start gap-2.5">
    <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
      <Icon name={icon} size={14} />
    </span>
    <div class="min-w-0">
      <h2 class="text-[14px] font-semibold tracking-tight">{title}</h2>
      <p class="mt-0.5 text-[12px] text-pretty text-muted-foreground">{description}</p>
    </div>
  </div>
{/snippet}

{#snippet Row(label: string, hint: string | undefined, control: Snippet)}
  <div class="flex items-start justify-between gap-4 border-b border-border px-3.5 py-3 last:border-b-0">
    <div class="min-w-0 pt-0.5">
      <div class="text-[13px] font-medium">{label}</div>
      {#if hint}
        <p class="mt-0.5 max-w-[24rem] text-[11.5px] leading-4 text-pretty text-muted-foreground">{hint}</p>
      {/if}
    </div>
    <div class="shrink-0">{@render control()}</div>
  </div>
{/snippet}

<!-- ---------------------------------- controls --------------------------------- -->

{#snippet themeControl()}
  <div class="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5" role="group" aria-label="Theme">
    {#each THEME_OPTIONS as option (option.value)}
      <button
        type="button"
        aria-pressed={settings.appearance.theme === option.value}
        onclick={() => setTheme(option.value)}
        class={cn(
          'inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors',
          settings.appearance.theme === option.value
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Icon name={option.icon} size={13} />
        <span>{option.label}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet accentControl()}
  <div class="flex items-center gap-2">
    <div class="flex items-center gap-1">
      {#each ACCENTS as accent (accent)}
        <button
          type="button"
          aria-label={`Accent ${accent}`}
          title={accent}
          onclick={() => void updateSettings({ appearance: { accent } })}
          class={cn(
            'size-5 rounded-full border border-border transition-transform hover:scale-110',
            settings.appearance.accent.toLowerCase() === accent.toLowerCase() &&
              'ring-2 ring-ring ring-offset-1 ring-offset-background'
          )}
          style={`background:${accent}`}
        ></button>
      {/each}
    </div>
    <Input
      type="color"
      aria-label="Custom accent color"
      value={settings.appearance.accent}
      oninput={(event) => commitAccent((event.currentTarget as HTMLInputElement).value)}
      class="h-7 w-9 cursor-pointer p-0.5"
    />
  </div>
{/snippet}

{#snippet fontScaleControl()}
  <div class="flex w-56 flex-col gap-1.5">
    <div class="flex items-center gap-2">
      <input
        type="range"
        min="0.8"
        max="1.4"
        step="0.05"
        value={fontScaleDraft}
        aria-label="Font scale"
        oninput={(event) => (fontScaleDraft = Number((event.currentTarget as HTMLInputElement).value))}
        onchange={(event) =>
          void updateSettings({ appearance: { fontScale: Number((event.currentTarget as HTMLInputElement).value) } })}
        class="w-full cursor-pointer"
        style="accent-color: var(--rasuko-accent)"
      />
      <span class="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
        {Math.round(fontScaleDraft * 100)}%
      </span>
    </div>
    <p class="truncate text-muted-foreground" style={`font-size:${(14 * fontScaleDraft).toFixed(1)}px`}>
      The quick brown fox
    </p>
  </div>
{/snippet}

{#snippet densityControl()}
  <div class="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5" role="group" aria-label="Density">
    {#each DENSITY_OPTIONS as option (option.value)}
      <button
        type="button"
        aria-pressed={settings.appearance.density === option.value}
        onclick={() => setDensity(option.value)}
        class={cn(
          'rounded px-2 py-1 text-[12px] transition-colors',
          settings.appearance.density === option.value
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {option.label}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet markdownControl()}
  <Switch
    checked={settings.editor.markdown}
    onCheckedChange={(value) => void updateSettings({ editor: { markdown: value } })}
    aria-label="Markdown input mode"
  />
{/snippet}

{#snippet spellcheckControl()}
  <Switch
    checked={settings.editor.spellcheck}
    onCheckedChange={(value) => void updateSettings({ editor: { spellcheck: value } })}
    aria-label="Spell check"
  />
{/snippet}

{#snippet fontControl()}
  <Select
    aria-label="Editor font"
    value={settings.editor.font}
    options={FONT_OPTIONS}
    onchange={(value) => void updateSettings({ editor: { font: value as EditorFont } })}
    class="w-40"
  />
{/snippet}

{#snippet widthControl()}
  <Select
    aria-label="Default content width"
    value={settings.editor.contentWidth}
    options={WIDTH_OPTIONS}
    onchange={(value) =>
      void updateSettings({ editor: { contentWidth: value as RasukoSettings['editor']['contentWidth'] } })}
    class="w-40"
  />
{/snippet}

{#snippet blockHandlesControl()}
  <Switch
    checked={settings.editor.showBlockHandles}
    onCheckedChange={(value) => void updateSettings({ editor: { showBlockHandles: value } })}
    aria-label="Show block handles"
  />
{/snippet}

{#snippet mainModelControl()}
  <div class="flex w-52 flex-col gap-1.5">
    <Select
      aria-label="Model provider"
      value={settings.assistant.model.providerId}
      options={mainProviderOptions}
      onchange={(value) => setName('main', value)}
      placeholder={mainProviderOptions.length === 0 ? 'No providers connected' : 'Select provider…'}
    />
    <ModelFamilySelector
      variant="fields"
      providerId={settings.assistant.model.providerId}
      modelId={settings.assistant.model.model}
      onchange={(next) => void updateSettings({ assistant: { model: next } })}
    />
  </div>
{/snippet}

{#snippet utilityModelControl()}
  <div class="flex w-52 flex-col gap-1.5">
    <Select
      aria-label="Utility model provider"
      value={settings.assistant.utilityModel.providerId}
      options={utilityProviderOptions}
      onchange={(value) => setName('utility', value)}
      placeholder=""
    />
    {#if settings.assistant.utilityModel.providerId}
      <ModelFamilySelector
        variant="fields"
        providerId={settings.assistant.utilityModel.providerId}
        modelId={settings.assistant.utilityModel.model}
        onchange={(next) => void updateSettings({ assistant: { utilityModel: next } })}
      />
    {:else}
      <div
        class="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-1"
      >
        <span class="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Icon name={ICONS.info} size={13} class="shrink-0" />
          <span class="truncate">Reuse the main model</span>
        </span>
        <Button size="sm" variant="ghost" disabled={configured.length === 0} onclick={setUtilityModel}>
          Set
        </Button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet temperatureControl()}
  <div class="flex w-56 items-center gap-2">
    <input
      type="range"
      min="0"
      max="1.5"
      step="0.1"
      value={temperatureDraft}
      aria-label="Temperature"
      oninput={(event) => (temperatureDraft = Number((event.currentTarget as HTMLInputElement).value))}
      onchange={(event) =>
        void updateSettings({ assistant: { temperature: Number((event.currentTarget as HTMLInputElement).value) } })}
      class="w-full cursor-pointer"
      style="accent-color: var(--rasuko-accent)"
    />
    <span class="w-8 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
      {temperatureDraft.toFixed(1)}
    </span>
  </div>
{/snippet}

{#snippet showThinkingControl()}
  <Switch
    checked={settings.assistant.showThinking}
    onCheckedChange={(value) => void updateSettings({ assistant: { showThinking: value } })}
    aria-label="Show thinking"
  />
{/snippet}

{#snippet autoApplyControl()}
  <Switch
    checked={settings.assistant.autoApplyViewOps}
    onCheckedChange={(value) => void updateSettings({ assistant: { autoApplyViewOps: value } })}
    aria-label="Auto-apply View changes"
  />
{/snippet}

{#snippet testControl()}
  <div class="flex items-center gap-2">
    {#if testState === 'running'}<Spinner size={13} />{/if}
    {#if testState === 'success'}<Badge tone="success">{testMessage || 'Ready'}</Badge>{/if}
    {#if testState === 'error'}<Badge tone="danger">{testMessage || 'Failed'}</Badge>{/if}
    {#if canTest}
      <Button size="sm" variant="outline" disabled={testState === 'running'} onclick={() => void testConnection()}>
        <Icon name={ICONS.refresh} size={13} />
        Test connection
      </Button>
    {:else}
      <Tooltip content={testHint} side="top">
        <span class="inline-flex">
          <Button size="sm" variant="outline" disabled>
            <Icon name={ICONS.refresh} size={13} />
            Test connection
          </Button>
        </span>
      </Tooltip>
    {/if}
  </div>
{/snippet}

{#snippet confirmDeleteControl()}
  <Switch
    checked={settings.workspace.confirmDelete}
    onCheckedChange={(value) => void updateSettings({ workspace: { confirmDelete: value } })}
    aria-label="Confirm before deleting"
  />
{/snippet}

{#snippet seedingControl()}
  <Switch
    checked={settings.workspace.seeding}
    onCheckedChange={(value) => void updateSettings({ workspace: { seeding: value } })}
    aria-label="Seed a starter page for new workspaces"
  />
{/snippet}

{#snippet openFolderControl()}
  <div class="flex items-center gap-2">
    {#if copied}<Badge tone="success">Copied</Badge>{/if}
    <Button size="sm" variant="outline" onclick={() => void openWorkspaceFolder()}>
      <Icon name={ICONS.copy} size={13} />
      Open workspace folder
    </Button>
  </div>
{/snippet}

<!-- ------------------------------------ page ----------------------------------- -->

<div class="flex h-full min-h-0 flex-col bg-background text-foreground">
  <header class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
    <IconButton icon={ICONS.arrowLeft} label="Back" onclick={() => void navigate('/')} />
    <h1 class="ml-0.5 text-[13px] font-medium">Settings</h1>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
    <div
      class="mx-auto flex w-full max-w-[1024px] flex-col gap-4 px-4 py-5 min-[720px]:flex-row min-[720px]:gap-8"
    >
      <div
        role="tablist"
        aria-label="Settings sections"
        tabindex="-1"
        onkeydown={(event) => void onNavKeydown(event)}
        class="flex shrink-0 gap-1 overflow-x-auto pb-1 scrollbar-thin min-[720px]:sticky min-[720px]:top-0 min-[720px]:w-[180px] min-[720px]:flex-col min-[720px]:self-start min-[720px]:overflow-visible min-[720px]:pb-0"
      >
        {#each SECTIONS as item (item.id)}
          <button
            type="button"
            role="tab"
            data-section={item.id}
            data-active={section === item.id}
            aria-selected={section === item.id}
            aria-current={section === item.id ? 'page' : undefined}
            tabindex={section === item.id ? 0 : -1}
            onclick={() => (section = item.id)}
            class={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] whitespace-nowrap transition-colors',
              section === item.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
            )}
          >
            <Icon name={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        {/each}
      </div>

      <div class="min-w-0 max-w-[640px] flex-1">
        {#if section === 'appearance'}
          {@render SectionHeading(ICONS.palette, 'Appearance', 'How Rasuko looks, reads and breathes.')}
          <div class="rounded-lg border border-border bg-card">
            {@render Row('Theme', 'System follows your operating system setting.', themeControl)}
            {@render Row('Accent', 'Used for selections, rings and the active nav item.', accentControl)}
            {@render Row('Font scale', 'Scales text across the app.', fontScaleControl)}
            {@render Row('Density', 'Compact tightens spacing for large screens.', densityControl)}
          </div>
        {:else if section === 'editor'}
          {@render SectionHeading(ICONS.page, 'Editor', 'Input affordances. Content is always stored as structured blocks.')}
          <div class="rounded-lg border border-border bg-card">
            {@render Row(
              'Markdown input mode',
              'Renders markdown as you type. Your content is always stored as structured blocks, so turning this off never rewrites anything.',
              markdownControl
            )}
            {@render Row('Spell check', 'Underline misspelled words while typing.', spellcheckControl)}
            {@render Row('Editor font', 'Typeface used for page content.', fontControl)}
            {@render Row('Default content width', 'How wide the writing column grows.', widthControl)}
            {@render Row('Show block handles', 'Show the drag handle beside each block.', blockHandlesControl)}
          </div>
        {:else if section === 'assistant'}
          {@render SectionHeading(ICONS.sparkles, 'Assistant', 'Which model answers, and how much it does on its own.')}
          <div class="rounded-lg border border-border bg-card">
            {@render Row('Model', 'Provider and model used for chat and View redesign.', mainModelControl)}
            {@render Row('Utility model', 'Cheap jobs like titles and small summaries. Leave as None to reuse the main model.', utilityModelControl)}
            {@render Row('Temperature', 'Higher values wander; lower values stay literal.', temperatureControl)}
            {@render Row('Show thinking', 'Reveal the model’s reasoning above each reply.', showThinkingControl)}
            {@render Row(
              'Auto-apply View changes',
              'When off, the assistant still proposes changes — you see a receipt before it becomes the page.',
              autoApplyControl
            )}
            {@render Row('Connection', 'Send a trivial prompt to confirm the model responds.', testControl)}
          </div>
        {:else if section === 'providers'}
          <div class="mb-3 flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-[14px] font-semibold tracking-tight">Providers</h2>
              <p class="mt-0.5 text-[12px] text-pretty text-muted-foreground">
                Credentials are stored locally and never leave this machine.
              </p>
            </div>
            <Button size="sm" variant={addingProvider ? 'secondary' : 'outline'} onclick={toggleAddProvider}>
              <Icon name={ICONS.add} size={14} />
              Add provider
            </Button>
          </div>

          {#if providers.loading && providers.providers.length === 0}
            <div class="flex justify-center py-8"><Spinner size={16} /></div>
          {/if}

          <div class="space-y-2">
            {#each configured as provider (provider.id)}
              <Panel
                title={provider.label}
                description={`${provider.models.length} ${provider.models.length === 1 ? 'model' : 'models'}`}
              >
                {#snippet action()}
                  <Badge tone={authTone(provider.authType)}>{authLabel(provider.authType)}</Badge>
                  <IconButton
                    icon={ICONS.delete}
                    label={`Remove ${provider.label}`}
                    onclick={() => askRemove(provider)}
                  />
                {/snippet}
              </Panel>
            {/each}

            {#if configured.length === 0 && !(providers.loading && providers.providers.length === 0)}
              <div class="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <span class="mx-auto mb-2 flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <Icon name={ICONS.plug} size={17} />
                </span>
                <p class="text-[13px] font-medium">No providers connected</p>
                <p class="mt-0.5 text-[11.5px] text-muted-foreground">
                  Rasuko works offline, but connecting a model unlocks View redesign.
                </p>
              </div>
            {/if}
          </div>

          {#if addingProvider}
            <div class="mt-3 rounded-lg border border-border bg-card">
              {#if addStep === 'pick'}
                <div class="border-b border-border p-3.5">
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-[13px] font-medium">Choose a provider</span>
                    <Button size="sm" variant="ghost" onclick={toggleAddProvider}>Close</Button>
                  </div>
                  <div class="mt-2.5 flex flex-wrap items-center gap-2">
                    <div class="relative min-w-[12rem] flex-1">
                      <Icon
                        name={ICONS.search}
                        size={14}
                        class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        bind:value={providerQuery}
                        placeholder="Search providers…"
                        aria-label="Search providers"
                        class="h-8 pl-7 text-[12.5px]"
                      />
                    </div>
                    <div class="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5" role="group" aria-label="Provider type">
                      {#each [{ value: 'all', label: 'All' }, { value: 'api_key', label: 'API key' }, { value: 'oauth', label: 'Subscription' }] as chip (chip.value)}
                        <button
                          type="button"
                          aria-pressed={providerFilter === chip.value}
                          onclick={() => (providerFilter = chip.value as 'all' | 'api_key' | 'oauth')}
                          class={cn(
                            'rounded px-2 py-1 text-[11.5px] transition-colors',
                            providerFilter === chip.value
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {chip.label}
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>

                <div class="max-h-72 overflow-y-auto p-1.5 scrollbar-thin">
                  {#if filteredProviders.length === 0}
                    <p class="px-2 py-6 text-center text-[12px] text-muted-foreground">No matching providers.</p>
                  {/if}
                  {#each filteredProviders as provider (provider.id)}
                    <button
                      type="button"
                      onclick={() => chooseProvider(provider)}
                      class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="truncate text-[12.5px] font-medium">{provider.label}</span>
                          {#if provider.configured}
                            <span class="shrink-0 text-[10.5px] text-success">Connected</span>
                          {/if}
                        </div>
                        {#if provider.description ?? provider.baseUrl}
                          <p class="truncate text-[10.5px] text-muted-foreground">
                            {provider.description ?? provider.baseUrl}
                          </p>
                        {/if}
                      </div>
                      <Badge tone={authTone(provider.authType)}>{authLabel(provider.authType)}</Badge>
                    </button>
                  {/each}
                </div>
              {:else if selectedProvider}
                <div class="border-b border-border p-3.5">
                  <div class="flex items-center gap-2">
                    <IconButton icon={ICONS.arrowLeft} label="Back to providers" onclick={backToPick} />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[13px] font-medium">{selectedProvider.label}</div>
                      <div class="truncate text-[11px] text-muted-foreground">
                        {selectedProvider.description ?? selectedProvider.baseUrl ?? ''}
                      </div>
                    </div>
                    <Badge tone={authTone(selectedProvider.authType)}>{authLabel(selectedProvider.authType)}</Badge>
                  </div>
                </div>

                <div class="space-y-3 p-3.5">
                  {#if connectError}
                    <div class="flex items-start gap-1.5 rounded-md bg-destructive/12 px-2.5 py-2 text-[12px] text-destructive">
                      <Icon name={ICONS.alert} size={13} class="mt-px shrink-0" />
                      <span class="min-w-0 flex-1 text-pretty">{connectError}</span>
                    </div>
                  {/if}

                  {#if selectedProvider.customBaseUrl}
                    <div class="space-y-1.5">
                      <label class="text-[12px] font-medium" for="provider-base-url">Base URL</label>
                      <Input
                        id="provider-base-url"
                        bind:value={baseUrl}
                        placeholder="https://api.example.com/v1"
                        aria-label="Base URL"
                      />
                    </div>
                    <div class="space-y-1.5">
                      <label class="text-[12px] font-medium" for="provider-custom-key">API key</label>
                      <div class="relative">
                        <Input
                          id="provider-custom-key"
                          type={showKey ? 'text' : 'password'}
                          bind:value={apiKey}
                          placeholder="sk-…"
                          aria-label="API key"
                          class="pr-8"
                        />
                        <IconButton
                          class="absolute right-0.5 top-0.5"
                          icon={showKey ? ICONS.eyeOff : ICONS.eye}
                          label={showKey ? 'Hide API key' : 'Show API key'}
                          onclick={() => (showKey = !showKey)}
                        />
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={discovering || !baseUrl.trim()}
                        onclick={() => void discover()}
                      >
                        {#if discovering}<Spinner size={12} />{/if}
                        Discover models
                      </Button>
                      <Button size="sm" disabled={connecting || !apiKey.trim()} onclick={() => void connectWithKey()}>
                        {#if connecting}<Spinner size={12} />{/if}
                        Connect
                      </Button>
                    </div>
                    {#if discovered.length > 0}
                      <div>
                        <p class="mb-1.5 text-[11.5px] text-muted-foreground">
                          {discovered.length} models discovered
                        </p>
                        <div class="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2 scrollbar-thin">
                          {#each discovered as model (model.id)}
                            <Badge tone="neutral">{model.label}</Badge>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  {:else if selectedProvider.authType === 'oauth' || selectedProvider.authType === 'mixed'}
                    <p class="text-[12px] text-pretty text-muted-foreground">
                      Sign in with your subscription. A browser window handles the consent step.
                    </p>
                    <Button size="sm" onclick={connectSubscription}>
                      <Icon name={ICONS.externalLink} size={13} />
                      Connect with subscription
                    </Button>
                  {:else}
                    {#if selectedProvider.authType === 'ambient'}
                      <div class="flex items-start gap-1.5 rounded-md bg-muted px-2.5 py-2 text-[11.5px] text-muted-foreground">
                        <Icon name={ICONS.info} size={13} class="mt-px shrink-0" />
                        <span class="min-w-0 flex-1 text-pretty">
                          Rasuko detects a key from your environment automatically. You can also paste one below.
                        </span>
                      </div>
                    {/if}
                    <div class="space-y-1.5">
                      <label class="text-[12px] font-medium" for="provider-key">API key</label>
                      <div class="relative">
                        <Input
                          id="provider-key"
                          type={showKey ? 'text' : 'password'}
                          bind:value={apiKey}
                          placeholder="sk-…"
                          aria-label="API key"
                          class="pr-8"
                        />
                        <IconButton
                          class="absolute right-0.5 top-0.5"
                          icon={showKey ? ICONS.eyeOff : ICONS.eye}
                          label={showKey ? 'Hide API key' : 'Show API key'}
                          onclick={() => (showKey = !showKey)}
                        />
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button size="sm" disabled={connecting || !apiKey.trim()} onclick={() => void connectWithKey()}>
                        {#if connecting}<Spinner size={12} />{/if}
                        Connect
                      </Button>
                      {#if selectedProvider.authType === 'ambient'}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={connecting}
                          onclick={() => void detectAmbient()}
                        >
                          <Icon name={ICONS.key} size={13} />
                          Detect from environment
                        </Button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {:else if section === 'workspace'}
          {@render SectionHeading(ICONS.layers, 'Workspace', 'Where your files live and how carefully they are treated.')}
          <div class="rounded-lg border border-border bg-card">
            {@render Row('Confirm before deleting', 'Ask before a page or project is removed.', confirmDeleteControl)}
            {@render Row(
              'Seed a starter page for new workspaces',
              'Applies on next launch.',
              seedingControl
            )}
            {@render Row('Workspace folder', appInfo?.home ?? 'Loading…', openFolderControl)}
          </div>
        {:else if section === 'about'}
          {@render SectionHeading(ICONS.info, 'About', 'Version, platform and how credentials are kept.')}
          <div class="rounded-lg border border-border bg-card p-3.5">
            {#if appInfo}
              <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-[12.5px]">
                <dt class="text-muted-foreground">Name</dt>
                <dd>{appInfo.name}</dd>
                <dt class="text-muted-foreground">Version</dt>
                <dd class="tabular-nums">{appInfo.version}</dd>
                <dt class="text-muted-foreground">Platform</dt>
                <dd>{appInfo.platform}</dd>
                <dt class="text-muted-foreground">Home</dt>
                <dd class="break-all font-mono text-[11.5px]">{appInfo.home}</dd>
              </dl>
            {:else}
              <div class="flex justify-center py-6"><Spinner size={16} /></div>
            {/if}
          </div>
          <p class="mt-3 text-[12px] text-pretty text-muted-foreground">
            Rasuko stores content as structured records with stable ids. Views are templates that bind to them — so
            redesigning a page never rewrites your content.
          </p>
          {#if appInfo}
            <div class="mt-3">
              <Badge tone={appInfo.encryptedCredentials ? 'success' : 'warning'}>
                {appInfo.encryptedCredentials
                  ? 'Credentials encrypted with the OS keychain'
                  : 'Credentials stored unencrypted (keychain unavailable)'}
              </Badge>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- --------------------------------- dialogs --------------------------------- -->

<Dialog
  bind:open={removeOpen}
  title="Remove provider?"
  description={removeTarget
    ? `${removeTarget.label} is disconnected and its credentials are deleted from this machine.`
    : ''}
>
  <p class="text-[12.5px] text-muted-foreground">Your content and Views are untouched.</p>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => (removeOpen = false)}>Cancel</Button>
    <Button variant="destructive" size="sm" onclick={() => void confirmRemove()}>Remove</Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={loginOpen}
  title="Connect account"
  description="Follow the steps below to finish signing in."
>
  <div class="max-h-[60vh] space-y-3 overflow-y-auto scrollbar-thin">
    {#each providers.loginEvents as event, index (index)}
      {#if event.type === 'loading' || event.type === 'progress'}
        <div class="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Spinner size={13} />
          <span>{event.message || 'Working…'}</span>
        </div>
      {:else if event.type === 'info'}
        <p class="text-[12.5px] text-pretty text-muted-foreground">{event.message}</p>
      {:else if event.type === 'auth_url'}
        <div class="space-y-1.5">
          <p class="text-[12.5px]">Open this link to continue:</p>
          <button
            type="button"
            class="flex w-full items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-accent"
            onclick={() => event.url && window.open(event.url)}
          >
            <Icon name={ICONS.externalLink} size={13} class="shrink-0 text-muted-foreground" />
            <span class="select-all truncate underline">{event.url}</span>
          </button>
          {#if event.instructions}
            <p class="text-[11.5px] text-pretty text-muted-foreground">{event.instructions}</p>
          {/if}
        </div>
      {:else if event.type === 'device_code'}
        <div class="space-y-1.5">
          <p class="text-[12.5px]">Enter this code in your browser:</p>
          <div class="select-all rounded-md bg-muted px-3 py-2 text-center font-mono text-lg tracking-[0.2em]">
            {event.userCode}
          </div>
          <p class="text-[11.5px] text-muted-foreground">
            at <span class="select-all">{event.verificationUri}</span>
          </p>
        </div>
      {:else if event.type === 'prompt'}
        <div class="space-y-1.5">
          <label class="text-[12px] font-medium" for={`login-prompt-${index}`}>{event.message}</label>
          <Input
            id={`login-prompt-${index}`}
            type={event.promptType === 'secret' ? 'password' : 'text'}
            bind:value={promptValue}
            placeholder={event.placeholder}
            disabled={!loginReady}
            aria-label={event.message}
          />
          <Button size="sm" disabled={!loginReady} onclick={() => void respondPrompt()}>Continue</Button>
        </div>
      {:else if event.type === 'select'}
        <div class="space-y-1.5">
          <p class="text-[12.5px]">{event.message}</p>
          <div class="flex flex-col gap-1">
            {#each event.options ?? [] as option (option.id)}
              <Button
                size="sm"
                variant="outline"
                class="justify-start"
                disabled={!loginReady}
                onclick={() => void respondSelect(option.id)}
              >
                <span class="min-w-0 truncate">{option.label}</span>
                {#if option.description}
                  <span class="truncate text-[10.5px] text-muted-foreground">{option.description}</span>
                {/if}
              </Button>
            {/each}
          </div>
        </div>
      {:else if event.type === 'manual_code'}
        <div class="space-y-1.5">
          <label class="text-[12px] font-medium" for={`login-manual-${index}`}>{event.message}</label>
          <Input
            id={`login-manual-${index}`}
            bind:value={manualCode}
            placeholder={event.placeholder}
            disabled={!loginReady}
            aria-label={event.message}
          />
          <Button size="sm" disabled={!loginReady} onclick={() => void respondManual()}>Submit</Button>
        </div>
      {:else if event.type === 'error'}
        <div class="flex items-start gap-1.5 rounded-md bg-destructive/12 px-2.5 py-2 text-[12px] text-destructive">
          <Icon name={ICONS.alert} size={13} class="mt-px shrink-0" />
          <span class="min-w-0 flex-1 text-pretty">{event.message}</span>
        </div>
      {:else if event.type === 'done'}
        <div class="flex items-center gap-1.5 text-[12.5px] text-success">
          <Icon name={ICONS.check} size={13} class="shrink-0" />
          Connected.
        </div>
      {/if}
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => void providers.cancelLogin()}>Cancel</Button>
  {/snippet}
</Dialog>
