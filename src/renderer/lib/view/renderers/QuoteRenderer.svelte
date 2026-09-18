<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import BoundTextEditor from '../BoundTextEditor.svelte'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const source = $derived(String(prop(node, 'source', '') ?? ''))
</script>

<figure class="space-y-2 border-l-2 border-border pl-3.5">
  <BoundTextEditor {node} {records} {editable} placeholder="Empty quote" blockType="quote" class="text-[15px] italic text-muted-foreground" blockClass="text-[15px] italic text-muted-foreground" />
  {#if source}
    <figcaption class="text-[11.5px] text-muted-foreground">— {source}</figcaption>
  {/if}
</figure>
