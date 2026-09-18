<script lang="ts">
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import { prop, toneAccent } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
    children?: Snippet
  }

  let { node, children }: Props = $props()

  const title = $derived(String(prop(node, 'title', '') ?? ''))
  const subtitle = $derived(String(prop(node, 'subtitle', '') ?? ''))
  const icon = $derived(String(prop(node, 'icon', '') ?? ''))
  const tone = $derived(prop(node, 'tone', 'neutral'))
  const collapsible = $derived(Boolean(prop(node, 'collapsible', false)))

  let open = $state(untrack(() => Boolean(prop(node, 'defaultOpen', true))))

  const hasHeader = $derived(Boolean(title || subtitle || icon))
</script>

<section class="overflow-hidden rounded-xl border border-border bg-card">
  {#if hasHeader}
    <header class="flex items-center gap-2.5 px-3.5 py-2.5">
      {#if icon}
        <span
          class={cn('flex size-6 shrink-0 items-center justify-center rounded-md', toneAccent(tone))}
        >
          <Icon name={icon} size={14} />
        </span>
      {/if}
      <div class="min-w-0 flex-1">
        {#if title}
          <h3 class="truncate text-[13px] font-medium leading-5">{title}</h3>
        {/if}
        {#if subtitle}
          <p class="truncate text-[11.5px] text-muted-foreground">{subtitle}</p>
        {/if}
      </div>
      {#if collapsible}
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          class="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onclick={() => (open = !open)}
        >
          <Icon name={open ? 'up-small-line' : 'down-small-line'} size={14} />
        </button>
      {/if}
    </header>
  {/if}
  {#if !collapsible || open}
    <div class={cn('flex flex-col gap-3 px-3.5 py-3', !hasHeader && 'px-3.5 py-3.5')}>
      {@render children?.()}
    </div>
  {/if}
</section>
