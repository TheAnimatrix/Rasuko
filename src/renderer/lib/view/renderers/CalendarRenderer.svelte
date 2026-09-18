<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'
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

  function dayKey(value: unknown): string | null {
    if (!value) return null
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return null
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  }

  const events = $derived.by(() => {
    const map = new Map<string, string[]>()
    for (const row of rows) {
      const key = dateColumn ? dayKey(row.cells[dateColumn.id]) : null
      if (!key) continue
      const label = titleColumn ? String(row.cells[titleColumn.id] ?? '') : ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(label || '—')
    }
    return map
  })

  const today = new Date()
  let year = $state(today.getFullYear())
  let month = $state(today.getMonth())

  const monthLabel = $derived(
    new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  )

  const cells = $derived.by(() => {
    const firstWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const out: Array<{ day: number; key: string; events: string[]; isToday: boolean } | null> = []
    for (let i = 0; i < firstWeekday; i += 1) out.push(null)
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${month}-${day}`
      out.push({
        day,
        key,
        events: events.get(key) ?? [],
        isToday:
          day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
      })
    }
    return out
  })

  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  function shift(delta: number): void {
    const next = new Date(year, month + delta, 1)
    year = next.getFullYear()
    month = next.getMonth()
  }
</script>

{#if !record || columns.length === 0}
  <EmptyState
    icon="calendar-line"
    title="No calendar data"
    description={record
      ? `No rows yet — add rows to “${recordLabel(record)}”.`
      : 'Bind a table record with a date column to build a calendar.'}
  />
{:else}
  <div class="rounded-xl border border-border bg-card p-3">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-[13px] font-medium">{monthLabel}</span>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Previous month"
          class="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          onclick={() => shift(-1)}
        >
          <Icon name="left-small-line" size={14} />
        </button>
        <button
          type="button"
          aria-label="Next month"
          class="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          onclick={() => shift(1)}
        >
          <Icon name="right-small-line" size={14} />
        </button>
      </div>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-[10.5px] text-muted-foreground">
      {#each WEEKDAYS as weekday, index (index)}
        <span>{weekday}</span>
      {/each}
    </div>
    <div class="mt-1 grid grid-cols-7 gap-1">
      {#each cells as cell, index (index)}
        {#if cell}
          <div
            class={cn(
              'min-h-14 rounded-md border p-1 text-left',
              cell.isToday ? 'border-ring bg-accent/40' : 'border-transparent'
            )}
          >
            <span
              class={cn(
                'text-[11px] tabular-nums',
                cell.isToday ? 'font-semibold text-accent-foreground' : 'text-muted-foreground'
              )}
            >
              {cell.day}
            </span>
            {#each cell.events.slice(0, 2) as event, index (index)}
              <p class="mt-0.5 truncate rounded bg-secondary px-1 text-[10.5px]">{event}</p>
            {/each}
            {#if cell.events.length > 2}
              <p class="text-[10px] text-muted-foreground">+{cell.events.length - 2}</p>
            {/if}
          </div>
        {:else}
          <div></div>
        {/if}
      {/each}
    </div>
  </div>
{/if}
