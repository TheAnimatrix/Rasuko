<script lang="ts">
  /**
   * Family-based model selector.
   *
   * Ported from Mousse: a provider catalog is presented as families with
   * orthogonal Context / Speed sub-options, and the chosen variant is encoded
   * back into the model id (`model:effort`) by the shared core.
   *
   * Two shapes:
   *  - `fields` — stacked labelled rows for the settings page.
   *  - `menu`  — the full Mousse picker: search, favorites, a provider/brand
   *    rail, a newest-first family list, and a hover side panel for variants.
   *    The caller owns the Popover and its trigger.
   */

  import type { ModelFamily, ModelFamilyGroup } from '@shared/modelVariants'
  import type { ModelOption } from '@shared/settings'
  import {
    compareModelsNewestFirst,
    findModelFamily,
    formatEffortLabel,
    groupModelsByFamily,
    groupProviderModels,
    parseModelVariant,
    parseThinkingSuffixFromModelId,
    resolveModelVariant
  } from '@shared/modelVariants'
  import { favoriteKey, loadModelFavorites, toggleModelFavorite } from '$lib/modelFavorites'
  import { providers } from '$lib/stores/providers.svelte'
  import { navigate } from '$lib/router'
  import { cn } from '$lib/utils'
  import { ICONS } from '$lib/icon-names'
  import Icon from '$lib/components/Icon.svelte'
  import ProviderIcon from '$lib/components/ProviderIcon.svelte'
  import Select from '$lib/components/ui/Select.svelte'

  interface Props {
    providerId: string
    modelId: string
    /** Called with the resolved model id (effort encoded as `model:effort`). */
    onchange: (next: { providerId: string; model: string }) => void
    /** `fields` = stacked rows (settings). `menu` = compact popover body (composer). */
    variant?: 'fields' | 'menu'
    /** Restrict to a single provider (composer) or allow switching provider. */
    lockProvider?: boolean
    class?: string
  }

  interface Selections {
    context: string | undefined
    effort: string | undefined
    speed: string | undefined
  }

  interface FlatEntry {
    providerId: string
    providerLabel: string
    family: ModelFamily
    brandId: string
    brandLabel: string
    key: string
  }

  let {
    providerId,
    modelId,
    onchange,
    variant = 'fields',
    lockProvider = false,
    class: className
  }: Props = $props()

  const providerList = $derived(providers.providers)

  function modelsFor(id: string): ModelOption[] {
    if (!id) return []
    return providerList.find((provider) => provider.id === id)?.models ?? []
  }

  function currentSelections(family: ModelFamily | undefined, models: ModelOption[]): Selections {
    const { baseId, effort: effortFromId } = parseThinkingSuffixFromModelId(modelId)
    const model =
      models.find((entry) => entry.id === modelId) ?? models.find((entry) => entry.id === baseId)
    const parsed = model ? parseModelVariant(model) : undefined
    return {
      context: parsed?.context ?? family?.contexts[0],
      effort: effortFromId ?? parsed?.effort ?? undefined,
      speed: parsed?.speed ?? family?.speeds[0]
    }
  }

  function applySelection(
    family: ModelFamily | undefined,
    groupId: string,
    context?: string,
    effort?: string,
    speed?: string
  ): void {
    if (!family) return
    const resolved = resolveModelVariant(family, { context, effort, speed })
    if (resolved) onchange({ providerId: groupId, model: resolved.id })
  }

  function isFamilySelected(family: ModelFamily, selectedModelId: string): boolean {
    const { baseId } = parseThinkingSuffixFromModelId(selectedModelId)
    return (
      family.variants.some((variant) => variant.id === selectedModelId) ||
      family.variants.some((variant) => variant.id === baseId)
    )
  }

  /** Seed a family's variant selection from the current model id. */
  function initialVariantOptions(
    family: ModelFamily,
    selectedModelId: string,
    preferredEffort?: string
  ): { context?: string; effort?: string; speed?: string } {
    const { baseId, effort: effortFromId } = parseThinkingSuffixFromModelId(selectedModelId)
    const selected =
      family.variants.find((variant) => variant.id === selectedModelId) ??
      family.variants.find((variant) => variant.id === baseId)

    const effortCandidate = effortFromId ?? preferredEffort
    const effort =
      (effortCandidate && family.efforts.includes(effortCandidate) ? effortCandidate : undefined) ??
      selected?.effort ??
      family.efforts[0]

    if (!selected) {
      return { context: family.contexts[0], effort, speed: family.speeds[0] }
    }
    return {
      context: selected.context ?? family.contexts[0],
      effort,
      speed: selected.speed ?? family.speeds[0]
    }
  }

  /* ------------------------------- fields variant ------------------------------ */

  const providerModels = $derived(modelsFor(providerId))
  const families = $derived(groupModelsByFamily(providerId, providerModels))
  const selectedFamily = $derived(
    findModelFamily(providerId, providerModels, modelId) ?? families[0]
  )
  const selections = $derived(currentSelections(selectedFamily, providerModels))
  const familyLabel = $derived(selectedFamily?.familyLabel ?? '')

  const familyOptions = $derived(
    families.map((family) => ({ value: family.familyLabel, label: family.familyLabel }))
  )
  const contextOptions = $derived(
    (selectedFamily?.contexts ?? []).map((context) => ({ value: context, label: context }))
  )
  const speedOptions = $derived(
    (selectedFamily?.speeds ?? []).map((speed) => ({ value: speed, label: speed }))
  )
  const hasBaseVariant = $derived(
    selectedFamily?.variants.some((entry) => !entry.effort) ?? false
  )
  const effortOptions = $derived.by(() => {
    const family = selectedFamily
    if (!family || family.efforts.length === 0) return [] as { value: string; label: string }[]
    const options = family.efforts.map((effort) => ({
      value: effort,
      label: formatEffortLabel(effort)
    }))
    if (hasBaseVariant) options.unshift({ value: 'off', label: 'None' })
    return options
  })
  const effortValue = $derived(selections.effort ?? (hasBaseVariant ? 'off' : ''))

  function onFamilyChange(label: string): void {
    const next = families.find((family) => family.familyLabel === label)
    if (!next) return
    applySelection(next, providerId, next.contexts[0], next.efforts[0], next.speeds[0])
  }

  /* -------------------------------- menu variant ------------------------------- */

  const menuGroups = $derived.by((): ModelFamilyGroup[] => {
    const source = lockProvider
      ? providerList.filter((provider) => provider.id === providerId)
      : providers.configured
    return source
      .filter((provider) => provider.models.length > 0)
      .map((provider) => groupProviderModels(provider.id, provider.label, provider.models))
  })

  const allEntries = $derived.by((): FlatEntry[] => {
    const entries: FlatEntry[] = []
    for (const group of menuGroups) {
      for (const family of group.families) {
        entries.push({
          providerId: group.providerId,
          providerLabel: group.label,
          family,
          brandId: family.brandId,
          brandLabel: family.brandLabel,
          key: favoriteKey(group.providerId, family.familyId)
        })
      }
    }
    return entries
  })

  const multiBrand = $derived(menuGroups.some((group) => group.brandSections.length > 1))

  /** Prefer brand filters when a multi-vendor catalog is present; else providers. */
  const railItems = $derived.by((): { id: string; label: string }[] => {
    if (multiBrand) {
      const seen = new Map<string, { id: string; label: string }>()
      for (const entry of allEntries) {
        if (!seen.has(entry.brandId)) {
          seen.set(entry.brandId, { id: entry.brandId, label: entry.brandLabel })
        }
      }
      return [...seen.values()]
    }
    return menuGroups.map((group) => ({ id: group.providerId, label: group.label }))
  })

  let favorites = $state<Set<string>>(loadModelFavorites())
  let menuQuery = $state('')
  let favoritesOnly = $state(false)
  let railFilter = $state<string | null>(null)
  let highlightIndex = $state(0)
  let activeFamily = $state<{ providerId: string; family: ModelFamily } | null>(null)
  let panelSide = $state<'right' | 'left'>('right')
  let panelTop = $state(0)

  let shellEl = $state<HTMLElement | null>(null)
  let menuEl = $state<HTMLElement | null>(null)
  let searchEl = $state<HTMLInputElement | null>(null)
  let activeRowEl = $state<HTMLElement | null>(null)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const preferredEffort = $derived(parseThinkingSuffixFromModelId(modelId).effort)

  const filteredEntries = $derived.by((): FlatEntry[] => {
    const query = menuQuery.trim().toLowerCase()
    const list = allEntries.filter((entry) => {
      if (favoritesOnly && !favorites.has(entry.key)) return false
      if (railFilter) {
        const matches = multiBrand
          ? entry.brandId === railFilter
          : entry.providerId === railFilter
        if (!matches) return false
      }
      if (!query) return true
      const haystack = [
        entry.family.familyLabel,
        entry.brandLabel,
        entry.providerLabel,
        ...entry.family.variants.map((variant) => variant.id),
        ...entry.family.variants.map((variant) => variant.label)
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
    return [...list].sort((a, b) =>
      compareModelsNewestFirst(
        `${a.family.familyLabel} ${a.family.variants[0]?.id ?? ''}`,
        `${b.family.familyLabel} ${b.family.variants[0]?.id ?? ''}`
      )
    )
  })

  const activeSelections = $derived(
    activeFamily ? currentSelections(activeFamily.family, modelsFor(activeFamily.providerId)) : null
  )

  function clearHideTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function scheduleHide(): void {
    clearHideTimer()
    hideTimer = setTimeout(() => {
      activeFamily = null
    }, 180)
  }

  function openVariantPanel(row: HTMLElement, entry: FlatEntry): void {
    clearHideTimer()
    if (!entry.family.hasSubOptions) {
      activeRowEl = null
      activeFamily = null
      return
    }
    activeRowEl = row
    activeFamily = { providerId: entry.providerId, family: entry.family }
  }

  function selectEntry(entry: FlatEntry): void {
    const resolved = resolveModelVariant(
      entry.family,
      initialVariantOptions(entry.family, modelId, preferredEffort)
    )
    if (resolved) onchange({ providerId: entry.providerId, model: resolved.id })
  }

  function chooseVariantOption(
    groupId: string,
    family: ModelFamily,
    patch: { context?: string; effort?: string; speed?: string }
  ): void {
    const base = currentSelections(family, modelsFor(groupId))
    const resolved = resolveModelVariant(family, {
      context: patch.context ?? base.context,
      effort: patch.effort ?? base.effort,
      speed: patch.speed ?? base.speed
    })
    if (resolved) onchange({ providerId: groupId, model: resolved.id })
  }

  function toggleFavorite(key: string): void {
    favorites = toggleModelFavorite(favorites, key)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
  }

  function openSettings(): void {
    void navigate('/settings')
  }

  /* Reset highlight + focus search whenever the result set changes. */
  $effect(() => {
    void menuQuery
    void railFilter
    void favoritesOnly
    void filteredEntries.length
    highlightIndex = 0
  })

  $effect(() => {
    const frame = requestAnimationFrame(() => searchEl?.focus())
    return () => cancelAnimationFrame(frame)
  })

  /* Keep the highlighted row visible. */
  $effect(() => {
    const index = highlightIndex
    const el = menuEl?.querySelector<HTMLElement>(`[data-model-index="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })

  /* Anchor the variant panel beside the active row, flipping side if needed. */
  $effect(() => {
    void activeFamily
    const shell = shellEl
    const row = activeRowEl
    if (!shell || !row) return
    const shellRect = shell.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    panelTop = Math.max(0, rowRect.top - shellRect.top)
    panelSide = window.innerWidth - shellRect.right >= 244 ? 'right' : 'left'
  })

  $effect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        activeFamily = null
        return
      }

      const mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && !event.shiftKey) {
        const digit = Number(event.key)
        if (digit >= 1 && digit <= 5) {
          const entry = filteredEntries[digit - 1]
          if (entry) {
            event.preventDefault()
            selectEntry(entry)
          }
          return
        }
      }

      if (isEditableTarget(event.target) && event.target !== searchEl) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        highlightIndex =
          filteredEntries.length === 0
            ? 0
            : Math.min(highlightIndex + 1, filteredEntries.length - 1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        highlightIndex = Math.max(highlightIndex - 1, 0)
        return
      }
      if (event.key === 'Enter') {
        const entry = filteredEntries[highlightIndex]
        if (entry) {
          event.preventDefault()
          selectEntry(entry)
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  $effect(() => () => clearHideTimer())
</script>

{#snippet chip(label: string, active: boolean, onselect: () => void)}
  <button
    type="button"
    class={cn(
      'rounded-full px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent',
      active ? 'bg-accent text-accent-foreground' : 'bg-secondary/60'
    )}
    onclick={onselect}
  >
    {label}
  </button>
{/snippet}

{#snippet variantSection(
  heading: string,
  options: string[],
  selected: string | undefined,
  onselect: (value: string) => void
)}
  {#if options.length > 0}
    <div class="[&+&]:mt-2.5">
      <div class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#each options as option (option)}
          {@render chip(option, selected === option, () => onselect(option))}
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet familyRow(entry: FlatEntry, index: number)}
  {@const selected = entry.providerId === providerId && isFamilySelected(entry.family, modelId)}
  {@const isFavorite = favorites.has(entry.key)}
  {@const isHighlighted = index === highlightIndex}
  {@const isActive =
    activeFamily?.providerId === entry.providerId &&
    activeFamily?.family.familyId === entry.family.familyId}
  <div
    data-model-index={index}
    role="presentation"
    class={cn(
      'flex items-center gap-0.5 rounded-lg transition-colors',
      (isHighlighted || isActive) && 'bg-accent/60',
      selected && 'bg-accent/40'
    )}
    onmouseenter={(event) => {
      highlightIndex = index
      openVariantPanel(event.currentTarget as HTMLElement, entry)
    }}
    onmouseleave={scheduleHide}
  >
    <button
      type="button"
      role="option"
      aria-selected={selected}
      class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
      onclick={() => selectEntry(entry)}
    >
      <span class="inline-flex size-[22px] shrink-0 items-center justify-center text-muted-foreground">
        <ProviderIcon providerId={entry.brandId} size={16} />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[13px] font-medium leading-tight text-foreground">
          {entry.family.familyLabel}
        </span>
        <span class="truncate text-[11px] leading-tight text-muted-foreground">
          {entry.brandLabel}
        </span>
      </span>
      {#if entry.family.hasSubOptions}
        <Icon name={ICONS.chevronRight} size={12} class="shrink-0 text-muted-foreground/55" />
      {/if}
      {#if index < 5}
        <span
          class="shrink-0 rounded-[5px] border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
        >
          Ctrl+{index + 1}
        </span>
      {/if}
    </button>
    <button
      type="button"
      class={cn(
        'mr-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
        !isFavorite && 'opacity-55'
      )}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      title={isFavorite ? 'Unfavorite' : 'Favorite'}
      onclick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFavorite(entry.key)
      }}
    >
      <Icon
        name={isFavorite ? ICONS.starFill : ICONS.starring}
        size={14}
        class={isFavorite ? 'text-warning' : ''}
      />
    </button>
  </div>
{/snippet}

{#if variant === 'fields'}
  {#if providerModels.length === 0}
    <p class="flex items-center gap-1.5 px-0.5 py-1 text-[12px] text-muted-foreground">
      <Icon name={ICONS.info} size={13} class="shrink-0" />
      No models available for this provider.
    </p>
  {:else}
    <div class={cn('flex flex-col gap-1.5', className)}>
      <Select
        aria-label="Model"
        placeholder=""
        value={familyLabel}
        options={familyOptions}
        onchange={onFamilyChange}
      />
      {#if selectedFamily && selectedFamily.contexts.length > 1}
        <Select
          aria-label="Context"
          placeholder=""
          value={selections.context ?? ''}
          options={contextOptions}
          onchange={(value) =>
            applySelection(selectedFamily, providerId, value || undefined, selections.effort, selections.speed)}
        />
      {/if}
      {#if selectedFamily && effortOptions.length > 0}
        <Select
          aria-label="Effort"
          placeholder=""
          value={effortValue}
          options={effortOptions}
          onchange={(value) =>
            applySelection(selectedFamily, providerId, selections.context, value || undefined, selections.speed)}
        />
      {/if}
      {#if selectedFamily && selectedFamily.speeds.length > 1}
        <Select
          aria-label="Speed"
          placeholder=""
          value={selections.speed ?? ''}
          options={speedOptions}
          onchange={(value) =>
            applySelection(selectedFamily, providerId, selections.context, selections.effort, value || undefined)}
        />
      {/if}
    </div>
  {/if}
{:else}
  {#if menuGroups.length === 0}
    <p class="flex items-center gap-1.5 px-3 py-3 text-[12px] text-muted-foreground">
      <Icon name={ICONS.info} size={13} class="shrink-0" />
      No models available for this provider.
    </p>
  {:else}
    <div bind:this={shellEl} class={cn('relative flex flex-col', className)}>
      <div class="flex items-center gap-2 border-b border-border/60 px-2.5 pb-2 pt-1.5">
        <button
          type="button"
          class={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            favoritesOnly && 'bg-warning/10 text-warning'
          )}
          aria-pressed={favoritesOnly}
          aria-label={favoritesOnly ? 'Show all models' : 'Show favorites only'}
          title={favoritesOnly ? 'Show all models' : 'Show favorites only'}
          onclick={() => (favoritesOnly = !favoritesOnly)}
        >
          <Icon
            name={favoritesOnly ? ICONS.starFill : ICONS.starring}
            size={14}
            class={favoritesOnly ? 'text-warning' : ''}
          />
        </button>
        <div class="relative min-w-0 flex-1">
          <Icon
            name={ICONS.search}
            size={14}
            class="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground/75"
          />
          <input
            bind:this={searchEl}
            bind:value={menuQuery}
            type="search"
            class="w-full bg-transparent py-1 pl-5 pr-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/80"
            placeholder="Search models…"
            aria-label="Search models"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="flex min-h-0 max-h-80">
        {#if railItems.length > 1}
          <div
            class="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/60 p-1.5"
            role="tablist"
            aria-label="Filter by provider"
          >
            <button
              type="button"
              role="tab"
              aria-selected={railFilter === null}
              class={cn(
                'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                railFilter === null && 'bg-accent text-accent-foreground'
              )}
              title="All models"
              onclick={() => (railFilter = null)}
            >
              <Icon name={ICONS.grid} size={16} />
            </button>
            {#each railItems as item (item.id)}
              <button
                type="button"
                role="tab"
                aria-selected={railFilter === item.id}
                class={cn(
                  'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                  railFilter === item.id && 'bg-accent text-accent-foreground'
                )}
                title={item.label}
                onclick={() => (railFilter = railFilter === item.id ? null : item.id)}
              >
                <ProviderIcon providerId={item.id} size={16} />
              </button>
            {/each}
          </div>
        {/if}

        <div
          bind:this={menuEl}
          class="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-1.5 scrollbar-thin"
          role="listbox"
          aria-label="Select model"
        >
          {#if filteredEntries.length === 0}
            <div class="px-3 py-4 text-center text-[13px] text-muted-foreground">
              {favoritesOnly ? 'No favorite models yet.' : 'No models match your search.'}
            </div>
          {:else}
            {#each filteredEntries as entry, index (entry.key)}
              {@render familyRow(entry, index)}
            {/each}
          {/if}
        </div>
      </div>

      {#if activeFamily && activeFamily.family.hasSubOptions}
        <aside
          class="absolute z-10 max-h-72 min-w-[220px] max-w-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-2.5 shadow-lg scrollbar-thin"
          style="top:{panelTop}px;{panelSide === 'right'
            ? 'left:calc(100% + 8px)'
            : 'right:calc(100% + 8px)'}"
          onmouseenter={clearHideTimer}
          onmouseleave={scheduleHide}
        >
          {@render variantSection(
            'Context',
            activeFamily.family.contexts,
            activeSelections?.context,
            (value) => chooseVariantOption(activeFamily!.providerId, activeFamily!.family, { context: value })
          )}
          {@render variantSection(
            'Speed',
            activeFamily.family.speeds,
            activeSelections?.speed,
            (value) => chooseVariantOption(activeFamily!.providerId, activeFamily!.family, { speed: value })
          )}
        </aside>
      {/if}
    </div>
  {/if}

  <div class="my-1 h-px bg-border"></div>
  <button
    type="button"
    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-accent"
    onclick={openSettings}
  >
    <Icon name={ICONS.settings} size={14} class="text-muted-foreground" />
    Open settings
  </button>
{/if}
