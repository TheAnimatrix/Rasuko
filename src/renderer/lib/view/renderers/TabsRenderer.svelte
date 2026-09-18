<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
    children?: Snippet<[{ activeTab?: number }]>
  }

  let { node, children }: Props = $props()

  const side = $derived(String(prop(node, 'side', 'top')))
  const labels = $derived(prop<string[]>(node, 'labels', []))

  const tabs = $derived(
    labels.length > 0 ? labels : (node.children ?? []).map((_, index) => `Tab ${index + 1}`)
  )

  let active = $state(0)

  const current = $derived(Math.min(active, Math.max(0, tabs.length - 1)))
</script>

<div class={cn('flex', side === 'left' ? 'flex-row gap-4' : 'flex-col gap-3')}>
  <div
    class={cn(
      'flex gap-1',
      side === 'left'
        ? 'w-40 shrink-0 flex-col'
        : 'flex-row flex-wrap border-b border-border pb-1'
    )}
  >
    {#each tabs as label, index (index)}
      <button
        type="button"
        class={cn(
          'rounded-md px-3 py-1.5 text-left text-[12.5px] transition-colors',
          current === index
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
        )}
        onclick={() => (active = index)}
      >
        {label}
      </button>
    {/each}
  </div>
  <div class="min-w-0 flex-1">{@render children?.({ activeTab: current })}</div>
</div>
