<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
    children?: Snippet
  }

  let { node, children }: Props = $props()

  const gap = $derived(Math.max(0, Number(prop(node, 'gap', 12)) || 0))
  const dividers = $derived(Boolean(prop(node, 'dividers', false)))
</script>

<div
  class={cn(
    'flex flex-col',
    dividers &&
      '[&>*:not(:first-child)]:border-t [&>*:not(:first-child)]:border-border [&>*:not(:first-child)]:pt-4'
  )}
  style="gap:{gap}px;"
>
  {@render children?.()}
</div>
