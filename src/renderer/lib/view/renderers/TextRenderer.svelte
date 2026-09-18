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

  const size = $derived(String(prop(node, 'size', 'base')))
  const muted = $derived(Boolean(prop(node, 'muted', false)))
  const placeholder = $derived(String(prop(node, 'placeholder', 'Write something…') ?? ''))

  const SIZES: Record<string, string> = {
    sm: 'text-[12.5px]',
    base: 'text-[14px]',
    lg: 'text-[16px] leading-relaxed'
  }

  const sizeClass = $derived(SIZES[size] ?? SIZES.base)
</script>

<BoundTextEditor
  {node}
  {records}
  {editable}
  {placeholder}
  class={cn(muted && 'text-muted-foreground')}
  blockClass={sizeClass}
/>
