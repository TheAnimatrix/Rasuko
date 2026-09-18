<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import Badge from '$lib/components/ui/Badge.svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { bindingDoc, prop } from '../props'
  import { firstBlockText } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
  }

  let { node, records }: Props = $props()

  const doc = $derived(bindingDoc(records, node.bind))
  const boundText = $derived(firstBlockText(doc))
  const text = $derived(boundText || String(prop(node, 'text', 'Status') ?? ''))
  const icon = $derived(String(prop(node, 'icon', '') ?? ''))
  const tone = $derived(prop(node, 'tone', 'neutral') as 'neutral' | 'info' | 'success' | 'warning' | 'danger')
</script>

<Badge {tone} class="text-[11.5px]">
  {#if icon}<Icon name={icon} size={12} />{/if}
  {text}
</Badge>
