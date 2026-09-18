<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import { formatDate } from '$lib/utils'
  import { bindingRecord, prop, recordLabel, tableRows } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const dateField = $derived(String(prop(node, 'dateField', '') ?? ''))
  const titleField = $derived(String(prop(node, 'titleField', '') ?? ''))

  const { columns, rows } = $derived(tableRows(record))

  const dateColumn = $derived(
    columns.find((column) => column.name === dateField || column.id === dateField) ??
      columns.find((column) => column.type === 'date') ??
      columns[0]
  )

  const titleColumn = $derived(
    columns.find((column) => column.name === titleField || column.id === titleField) ??
      columns.find((column) => column.id !== dateColumn?.id)
  )

  const items = $derived.by(() => {
    const out = rows.map((row) => {
      const raw = dateColumn ? row.cells[dateColumn.id] : null
      const time = raw ? new Date(String(raw)).getTime() : NaN
      return {
        id: row.id,
        time: Number.isNaN(time) ? null : time,
        label: String(raw ?? ''),
        title: titleColumn ? String(row.cells[titleColumn.id] ?? '') : ''
      }
    })
    return out.sort((a, b) => {
      if (a.time === null && b.time === null) return 0
      if (a.time === null) return 1
      if (b.time === null) return -1
      return a.time - b.time
    })
  })
</script>

{#if !record || columns.length === 0}
  <EmptyState
    icon="time-line"
    title="No timeline data"
    description={record
      ? `No rows yet — add rows to “${recordLabel(record)}”.`
      : 'Bind a table record with a date column to build a timeline.'}
  />
{:else}
  <ol class="relative ml-2 border-l border-border">
    {#each items as item (item.id)}
      <li class="relative pb-4 pl-5 last:pb-0">
        <span class="absolute -left-[4.5px] top-1 size-2 rounded-full border-2 border-background bg-primary"></span>
        <div class="flex items-baseline gap-2">
          <span class="text-[11px] tabular-nums text-muted-foreground">
            {item.time !== null ? formatDate(item.label) : item.label || '—'}
          </span>
          {#if item.title}
            <span class="text-[13.5px] font-medium">{item.title}</span>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}
