<script lang="ts">
  /**
   * Assistant panel.
   *
   * Takes no props — it reads the chat, workspace and settings stores directly.
   * The transcript is rendered by the ported 21st.dev Agent Elements surface
   * (`MessageList`), exactly as Mousse mounts it: the agent library owns turn
   * grouping and tool-card dispatch, while this shell keeps every composer
   * feature (model, effort, redesign mode) app-owned.
   */

  import {
    applyEffortToModelId,
    formatEffortLabel,
    getCurrentEffort,
    getEffortsForModel,
    getGroupedModelButtonLabel
  } from '@shared/modelVariants'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { chat } from '$lib/stores/chat.svelte'
  import { settingsStore, updateSettings } from '$lib/stores/settings.svelte'
  import { providers } from '$lib/stores/providers.svelte'
  import { navigate } from '$lib/router'
  import { ICONS } from '$lib/icon-names'
  import { relativeTime } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import ProviderIcon from '$lib/components/ProviderIcon.svelte'
  import IconButton from '$lib/components/ui/IconButton.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Popover from '$lib/components/ui/Popover.svelte'
  import Switch from '$lib/components/ui/Switch.svelte'
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  import ModelFamilySelector from '$lib/components/ModelFamilySelector.svelte'
  import MessageList from '$lib/chat/agent-elements/MessageList.svelte'

  const SUGGESTIONS = [
    'Turn this into a project tracker',
    'Make this a dashboard',
    'Add a checklist',
    'Back to plain notes'
  ]

  /** Mirrors the main-process heuristic so the mode badge is honest. */
  const REDESIGN_HINTS = [
    'redesign',
    'restructure',
    'turn this',
    'turn it',
    'make this',
    'make it',
    'convert',
    'rebuild',
    'reorganize',
    'reorganise',
    'layout',
    'dashboard',
    'tracker',
    'kanban',
    'board',
    'checklist',
    'form',
    'table for',
    'add a chart',
    'add metrics',
    'back to notes'
  ]

  function looksLikeRedesign(text: string): boolean {
    const lowered = text.toLowerCase()
    return REDESIGN_HINTS.some((hint) => lowered.includes(hint))
  }

  let draft = $state('')
  let redesign = $state(false)
  let historyOpen = $state(false)
  let modelOpen = $state(false)
  let effortOpen = $state(false)
  let composerEl = $state<HTMLTextAreaElement | null>(null)

  const configured = $derived(providers.configured)
  const showThinking = $derived(settingsStore.value?.assistant.showThinking ?? true)
  const activeModel = $derived(settingsStore.value?.assistant.model ?? { providerId: '', model: '' })
  const activeProvider = $derived(
    providers.providers.find((entry) => entry.id === activeModel.providerId) ?? null
  )
  const activeModelLabel = $derived.by(() => {
    const active = activeModel
    if (!active.providerId || !active.model) return 'No model'
    return getGroupedModelButtonLabel(active.providerId, active.model, providers.providers)
  })
  const availableEfforts = $derived(
    getEffortsForModel(activeModel.providerId, activeModel.model, activeProvider?.models ?? [])
  )
  const currentEffort = $derived(
    getCurrentEffort(activeModel.model, activeProvider?.models ?? [], activeModel.providerId) ??
      availableEfforts[0]
  )

  function selectEffort(effort: string): void {
    effortOpen = false
    void updateSettings({
      assistant: { model: { ...activeModel, model: applyEffortToModelId(activeModel.model, effort) } }
    })
  }
  const effectiveArchitect = $derived(redesign || looksLikeRedesign(draft))
  const receipt = $derived(chat.lastReceipt)
  const orphanedCount = $derived(receipt?.orphanedRecords.length ?? 0)

  // Auto-grow the composer between 2 and 8 rows.
  $effect(() => {
    const element = composerEl
    const value = draft
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 40), 192)}px`
    void value
  })

  async function submit(): Promise<void> {
    const text = draft.trim()
    if (!text || chat.isStreaming || chat.loading) return
    const mode = effectiveArchitect ? 'architect' : 'chat'
    draft = ''
    await chat.send(text, mode)
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void submit()
  }

  function useSuggestion(text: string): void {
    if (!workspace.activePageId || chat.isStreaming) return
    void chat.send(text, 'architect')
  }

  async function newChat(): Promise<void> {
    await chat.newChat()
    historyOpen = false
    requestAnimationFrame(() => composerEl?.focus())
  }

  async function selectConversation(conversationId: string): Promise<void> {
    await chat.selectConversation(conversationId)
    historyOpen = false
    requestAnimationFrame(() => composerEl?.focus())
  }

  /**
   * Hide the panel. The shell owns panel layout, so this only announces intent:
   * it listens for `rasuko:toggle-assistant` and flips its own collapsed state.
   */
  function hideAssistant(): void {
    try {
      localStorage.setItem('rasuko:assistant-collapsed', '1')
    } catch {
      // Session state only.
    }
    window.dispatchEvent(new CustomEvent('rasuko:toggle-assistant'))
  }

  function focusUnplaced(): void {
    window.dispatchEvent(new CustomEvent('rasuko:focus-unplaced'))
  }
</script>

<div class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card text-card-foreground">
  <header class="drag-region flex h-11 shrink-0 items-center gap-1 px-3.5">
    <Icon name={ICONS.sparkles} size={15} class="shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.01em]">
      Assistant
    </span>

    <Popover bind:open={historyOpen} side="bottom" align="end" class="w-72 p-1.5">
      {#snippet trigger()}
        <IconButton
          class="no-drag"
          icon={ICONS.history}
          label="Chat history"
          size={15}
          disabled={!workspace.activePageId || chat.isStreaming || chat.loading}
        />
      {/snippet}
      <div class="flex items-center justify-between gap-2 px-1.5 py-1">
        <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">History</span>
        <Button size="sm" variant="ghost" onclick={() => void newChat()}>
          <Icon name={ICONS.add} size={13} />
          New chat
        </Button>
      </div>
      <div class="mt-1 max-h-72 space-y-0.5 overflow-y-auto scrollbar-thin">
        {#each chat.sessions as session (session.id)}
          <button
            type="button"
            class="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:bg-accent/70"
            disabled={session.id === chat.conversationId}
            onclick={() => void selectConversation(session.id)}
          >
            <Icon
              name={session.id === chat.conversationId ? 'check-line' : ICONS.chat}
              size={13}
              class="mt-0.5 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12.5px] font-medium">{session.title}</span>
              <span class="mt-0.5 block text-[10.5px] text-muted-foreground">
                {relativeTime(session.updatedAt)} · {session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}
              </span>
            </span>
          </button>
        {:else}
          <p class="px-2 py-5 text-center text-[12px] text-muted-foreground">No previous chats</p>
        {/each}
      </div>
    </Popover>
    <IconButton
      class="no-drag"
      icon={ICONS.close}
      label="Hide assistant"
      size={15}
      onclick={hideAssistant}
    />
  </header>

  <div class="flex min-h-0 flex-1 flex-col">
    {#if chat.error}
      <div
        class="mx-3.5 mt-3 flex items-start gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
      >
        <Icon name={ICONS.alert} size={13} class="mt-px shrink-0" />
        <span class="min-w-0 flex-1 break-words text-pretty">{chat.error}</span>
      </div>
    {/if}

    <MessageList messages={chat.messages} pending={chat.pending} {showThinking}>
      {#snippet empty()}
        <div class="flex min-w-0 flex-col">
          <div class="px-1 pt-6 text-[12.5px] font-medium text-muted-foreground">Suggestions</div>
          {#each SUGGESTIONS as suggestion (suggestion)}
            <button
              type="button"
              class="w-full rounded-lg px-1 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              disabled={!workspace.activePageId}
              onclick={() => useSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          {/each}
        </div>
      {/snippet}

      {#snippet footer()}
        {#if receipt}
          <div class="min-w-0 rounded-xl border border-border bg-background p-3">
            <div class="flex min-w-0 items-center gap-1.5">
              <Icon name={ICONS.sparkles} size={14} class="shrink-0 text-muted-foreground" />
              <span class="text-[12.5px] font-medium">Redesigned this View</span>
            </div>
            <div class="mt-0.5 min-w-0 truncate text-[12.5px] text-muted-foreground">
              {receipt.viewName}
            </div>
            <div class="mt-1 text-[11.5px] text-muted-foreground">
              {receipt.applied} applied · {receipt.skipped.length} skipped
            </div>
            {#if orphanedCount > 0}
              <div class="mt-2 rounded-lg bg-warning/12 px-2.5 py-2 text-[11.5px] text-warning">
                <span class="block break-words text-pretty">
                  {orphanedCount}
                  {orphanedCount === 1 ? 'content record was' : 'content records were'} unplaced but
                  kept. Reattach them from the page.
                </span>
                <Button variant="outline" size="sm" class="mt-2" onclick={focusUnplaced}>
                  Review unplaced content
                </Button>
              </div>
            {/if}
          </div>
        {/if}

        {#if chat.suggestions.length > 0}
          <div class="min-w-0 rounded-xl border border-border bg-background p-3">
            <div class="flex items-center gap-1.5">
              <Icon name={ICONS.inbox} size={13} class="shrink-0 text-muted-foreground" />
              <span class="text-[12.5px] font-medium">Unplaced content</span>
              <span class="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {chat.suggestions.length}
              </span>
            </div>
            <p class="mt-0.5 text-[11.5px] text-muted-foreground text-pretty">
              Content the last redesign left unbound. Reattach it to keep it on the page.
            </p>
            <div class="mt-2 space-y-1">
              {#each chat.suggestions as suggestion (suggestion.recordId)}
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-[12px]">{suggestion.label}</span>
                  {#if suggestion.targetNodeId}
                    <Button
                      size="sm"
                      variant="outline"
                      onclick={() => {
                        const target = suggestion.targetNodeId
                        if (target) void workspace.reattach(suggestion.recordId, target)
                      }}
                    >
                      Reattach
                    </Button>
                  {:else}
                    <Tooltip content="Open the page to choose a destination" side="left">
                      <span class="inline-flex">
                        <Button size="sm" variant="outline" disabled onclick={() => {}}>Reattach</Button>
                      </span>
                    </Tooltip>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/snippet}
    </MessageList>
  </div>

  <div class="shrink-0">
    {#if configured.length === 0}
      <div
        class="mx-2.5 mb-2 flex items-start gap-1.5 rounded-xl bg-secondary/70 px-3 py-2 text-[11.5px] text-muted-foreground"
      >
        <Icon name={ICONS.info} size={13} class="mt-px shrink-0" />
        <span class="min-w-0 flex-1 text-pretty">
          No model connected — running in offline mode. Rasuko can still restructure pages
          deterministically.
          <button
            type="button"
            class="underline underline-offset-2"
            onclick={() => void navigate('/settings')}
          >
            Open settings
          </button>
        </span>
      </div>
    {/if}

    <div class="mx-2.5 mb-1 flex items-center justify-end gap-1.5">
      <label
        class="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground select-none"
      >
        <span>Redesign mode</span>
        <Switch
          checked={redesign}
          onCheckedChange={(value) => (redesign = value)}
          aria-label="Redesign mode"
        />
      </label>
    </div>

    <div
      class="mx-2.5 mb-2.5 rounded-2xl border border-border bg-background p-3 transition-colors focus-within:border-ring"
    >
      <textarea
        bind:this={composerEl}
        bind:value={draft}
        onkeydown={onKeydown}
        rows={2}
        placeholder="Ask anything…"
        aria-label="Message the assistant"
        disabled={!workspace.activePageId}
        class="block max-h-[12rem] min-h-[2.5rem] w-full resize-none overflow-y-auto bg-transparent px-0.5 text-[13px] leading-6 text-foreground outline-none scrollbar-thin placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60"
      ></textarea>

      <div class="mt-2 flex items-center justify-between">
        <div class="flex min-w-0 items-center gap-1">
          <Popover bind:open={modelOpen} side="top" align="start" class="w-80 overflow-visible p-0">
            {#snippet trigger()}
              <button
                type="button"
                class="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
              >
                {#if activeProvider}
                  <ProviderIcon providerId={activeModel.providerId} size={13} />
                {:else}
                  <Icon name={ICONS.ai} size={13} class="shrink-0" />
                {/if}
                <span class="max-w-[10rem] truncate">{activeModelLabel}</span>
                <Icon name={ICONS.chevronDown} size={12} class="shrink-0" />
              </button>
            {/snippet}
            <ModelFamilySelector
              variant="menu"
              providerId={activeModel.providerId}
              modelId={activeModel.model}
              lockProvider={false}
              onchange={(next) => {
                void updateSettings({ assistant: { model: next } })
                modelOpen = false
              }}
            />
          </Popover>

          {#if availableEfforts.length > 0}
            <Popover bind:open={effortOpen} side="top" align="start" class="w-40 p-1">
              {#snippet trigger()}
                <button
                  type="button"
                  class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
                  aria-label={`Thinking effort: ${formatEffortLabel(currentEffort ?? 'medium')}`}
                  title={`Thinking effort: ${formatEffortLabel(currentEffort ?? 'medium')}`}
                >
                  <Icon name={ICONS.brain} size={13} class="shrink-0" />
                  <span>{formatEffortLabel(currentEffort ?? availableEfforts[0] ?? 'medium')}</span>
                  <Icon name={ICONS.chevronDown} size={12} class="shrink-0" />
                </button>
              {/snippet}
              {#each availableEfforts as effort (effort)}
                <button
                  type="button"
                  role="option"
                  aria-selected={currentEffort === effort}
                  class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-accent"
                  onclick={() => selectEffort(effort)}
                >
                  <span>{formatEffortLabel(effort)}</span>
                  {#if currentEffort === effort}
                    <Icon name={ICONS.check} size={13} class="text-accent-foreground" />
                  {/if}
                </button>
              {/each}
            </Popover>
          {/if}
        </div>

        {#if chat.isStreaming}
          <button
            type="button"
            aria-label="Stop"
            onclick={() => void chat.abort()}
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
          >
            <Icon name={ICONS.stop} size={15} />
          </button>
        {:else}
          <button
            type="button"
            aria-label="Send"
            disabled={!draft.trim() || !workspace.activePageId}
            onclick={() => void submit()}
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style="background: var(--rasuko-accent)"
          >
            <Icon name={ICONS.send} size={15} />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
