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

  const language = $derived(String(prop(node, 'language', '') ?? ''))
</script>

<div class="overflow-hidden rounded-xl border border-border bg-card">
  {#if language}
    <div class="flex items-center justify-between border-b border-border px-3 py-1.5">
      <span class="font-mono text-[11px] text-muted-foreground">{language}</span>
    </div>
  {/if}
  <div class="px-3.5 py-3"><BoundTextEditor {node} {records} {editable} placeholder="// no code" blockType="code" class="font-mono text-[12px]" blockClass="font-mono text-[12px]" /></div>
</div>
