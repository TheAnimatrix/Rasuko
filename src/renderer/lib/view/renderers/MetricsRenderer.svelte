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

  const columns = $derived(Math.min(4, Math.max(2, Number(prop(node, 'columns', 4)) || 4)))

  const COUNT_CLASSES: Record<number, string> = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4'
  }

  const countClass = $derived(COUNT_CLASSES[columns] ?? COUNT_CLASSES[4])
</script>

<div class={cn('grid [&>*]:min-w-0', countClass)} style="gap:12px;">
  {@render children?.()}
</div>
