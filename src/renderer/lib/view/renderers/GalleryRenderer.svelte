<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import { bindingRecord, prop, recordLabel, tableRows } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const imageField = $derived(String(prop(node, 'imageField', '') ?? ''))
  const captionField = $derived(String(prop(node, 'captionField', '') ?? ''))
  const columns = $derived(Math.min(6, Math.max(2, Number(prop(node, 'columns', 3)) || 3)))

  const COLUMNS: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    5: 'grid-cols-3 md:grid-cols-5',
    6: 'grid-cols-3 md:grid-cols-6'
  }

  const items = $derived.by(() => {
    if (!record) return []
    if (record.kind === 'list') {
      return record.items.map((item) => ({ id: item.id, src: item.text, caption: '' }))
    }
    if (record.kind === 'table') {
      const { columns: cols, rows } = tableRows(record)
      const imageColumn =
        cols.find((column) => column.name === imageField || column.id === imageField) ??
        cols.find((column) => column.type === 'url') ??
        cols[0]
      const captionColumn = cols.find(
        (column) => column.name === captionField || column.id === captionField
      )
      if (!imageColumn) return []
      return rows.map((row) => ({
        id: row.id,
        src: String(row.cells[imageColumn.id] ?? ''),
        caption: captionColumn ? String(row.cells[captionColumn.id] ?? '') : ''
      }))
    }
    return []
  })
</script>

{#if !record || items.length === 0}
  <EmptyState
    icon="album-line"
    title="No gallery data"
    description={record
      ? `Add rows to “${recordLabel(record)}” to fill this gallery.`
      : 'Bind a table or list record of image URLs.'}
  />
{:else}
  <div class={cn('grid gap-2', COLUMNS[columns] ?? COLUMNS[3])}>
    {#each items as item (item.id)}
      <figure class="min-w-0 space-y-1">
        {#if item.src}
          <img
            src={item.src}
            alt={item.caption}
            loading="lazy"
            class="aspect-square w-full rounded-lg border border-border object-cover"
          />
        {:else}
          <div
            class="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-muted-foreground"
          >
            No image
          </div>
        {/if}
        {#if item.caption}
          <figcaption class="truncate text-[11px] text-muted-foreground">{item.caption}</figcaption>
        {/if}
      </figure>
    {/each}
  </div>
{/if}
