<script lang="ts">
  /**
   * ToolRowBase — 21st.dev Agent Elements.
   *
   * The single row shape every tool call collapses into: icon, a label that
   * shimmers while running, a muted detail, optional trailing content, and an
   * optional expand affordance. Specialised cards (Edit, Plan, Search) all
   * build on this row.
   */

  import type { Snippet } from 'svelte'
  import { ICONS } from '$lib/icon-names'
  import { cn } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import TextShimmer from './TextShimmer.svelte'

  interface Props {
    icon?: string
    spinner?: boolean
    shimmerLabel?: string
    completeLabel: string
    isAnimating?: boolean
    detail?: string
    expandable?: boolean
    defaultOpen?: boolean
    tone?: 'default' | 'danger'
    trailing?: Snippet
    children?: Snippet
  }

  let {
    icon,
    spinner = false,
    shimmerLabel,
    completeLabel,
    isAnimating = false,
    detail,
    expandable = false,
    defaultOpen = false,
    tone = 'default',
    trailing,
    children
  }: Props = $props()

  let open = $state(false)

  // Honour `defaultOpen` without capturing the prop's initial value.
  $effect.pre(() => {
    open = defaultOpen
  })
</script>

{#snippet row()}
  <div
    class={cn(
      'flex w-full min-w-0 max-w-full select-none items-center gap-1 rounded-[var(--an-tool-border-radius)]',
      expandable ? 'cursor-pointer' : 'cursor-default'
    )}
  >
    <div class="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
      {#if spinner}
        <span class="flex size-3.5 shrink-0 items-center justify-center">
          <Icon name={ICONS.loading} size={12} class="animate-spin" />
        </span>
      {:else if icon}
        <span class="flex size-3.5 shrink-0 items-center justify-center">
          <Icon name={icon} size={13} />
        </span>
      {/if}
      <span
        class={cn(
          'shrink-0 whitespace-nowrap font-[450]',
          tone === 'danger' && 'text-destructive'
        )}
      >
        {#if isAnimating && shimmerLabel}
          <TextShimmer duration={1.2} class="flex items-center">{shimmerLabel}</TextShimmer>
        {:else}
          {completeLabel}
        {/if}
      </span>
      {#if detail}
        <span class="min-w-0 flex-1 truncate font-normal text-muted-foreground/60">{detail}</span>
      {/if}
      {@render trailing?.()}
    </div>
    {#if expandable}
      <Icon
        name={ICONS.chevronRight}
        size={12}
        class={cn(
          'ml-auto shrink-0 text-muted-foreground transition-transform duration-150 ease-out',
          open && 'rotate-90'
        )}
      />
    {/if}
  </div>
{/snippet}

<div class="an-tool-chrome flex w-full flex-col gap-1.5">
  {#if expandable}
    <button
      type="button"
      class="flex w-full text-left"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      {@render row()}
    </button>
  {:else}
    {@render row()}
  {/if}
  {#if expandable && open}
    {@render children?.()}
  {/if}
</div>
