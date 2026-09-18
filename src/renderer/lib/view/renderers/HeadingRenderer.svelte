<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import BoundTextEditor from '../BoundTextEditor.svelte'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const level = $derived(Math.min(4, Math.max(1, Number(prop(node, 'level', 1)) || 1)))
  const placeholder = $derived(String(prop(node, 'placeholder', 'Untitled') ?? ''))

  const HEADING: Record<number, string> = {
    1: 'text-[22px] font-semibold tracking-tight leading-snug',
    2: 'text-[17px] font-semibold tracking-tight leading-snug',
    3: 'text-[15px] font-semibold leading-snug',
    4: 'text-[13.5px] font-semibold uppercase tracking-wide'
  }
</script>

<BoundTextEditor
  {node}
  {records}
  {editable}
  {placeholder}
  {level}
  blockClass={cn(HEADING[level])}
/>
