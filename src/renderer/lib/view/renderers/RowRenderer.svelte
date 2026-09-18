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
  const wrap = $derived(Boolean(prop(node, 'wrap', true)))

  const ALIGN: Record<string, string> = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch'
  }

  const alignClass = $derived(ALIGN[String(prop(node, 'align', 'stretch'))] ?? ALIGN.stretch)
</script>

<div class={cn('flex flex-row', alignClass, wrap && 'flex-wrap')} style="gap:{gap}px;">
  {@render children?.()}
</div>
