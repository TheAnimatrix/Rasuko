<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import { blockPlainText } from '@shared/richtext'
  import { bindingRecord, prop, tableRows } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const ordered = $derived(Boolean(prop(node, 'ordered', false)))
  const columns = $derived(Math.min(3, Math.max(1, Number(prop(node, 'columns', 1)) || 1)))

  const items = $derived.by<string[]>(() => {
    if (!record) return []
    if (record.kind === 'list') return record.items.map((item) => item.text)
    if (record.kind === 'table') {
      const { columns: cols, rows } = tableRows(record)
      if (cols.length === 0) return []
      return rows.map((row) => String(row.cells[cols[0].id] ?? '')).filter((text) => text.length > 0)
    }
    if (record.kind === 'richtext') {
      return record.doc.blocks
        .filter((block) => block.type === 'bullet' || block.type === 'numbered')
        .map((block) => blockPlainText(block))
        .filter((text) => text.length > 0)
    }
    return []
  })

  const COLUMNS: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
  }
</script>

{#if items.length === 0}
  <p class="text-[12.5px] text-muted-foreground/50">No items</p>
{:else if ordered}
  <ol class={cn('ml-4 list-decimal space-y-1 text-[13.5px]', COLUMNS[columns])}>
    {#each items as item, index (index)}
      <li>{item}</li>
    {/each}
  </ol>
{:else}
  <ul class={cn('ml-4 list-disc space-y-1 text-[13.5px] marker:text-muted-foreground', COLUMNS[columns])}>
    {#each items as item, index (index)}
      <li>{item}</li>
    {/each}
  </ul>
{/if}
