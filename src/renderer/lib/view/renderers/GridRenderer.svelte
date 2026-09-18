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

  const gap = $derived(Math.max(0, Number(prop(node, 'gap', 16)) || 0))
  const minColumn = $derived(Math.max(120, Number(prop(node, 'minColumn', 220)) || 220))
</script>

<div
  class={cn('grid grid-cols-12 [&>*]:min-w-0')}
  style="gap:{gap}px; --rasuko-min-col:{minColumn}px;"
>
  {@render children?.()}
</div>
