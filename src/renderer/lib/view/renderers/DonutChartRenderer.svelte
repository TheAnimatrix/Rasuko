<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import { formatNumber } from '$lib/utils'
  import { bindingRecord, prop, recordLabel, seriesFromTable } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const series = $derived(
    seriesFromTable(
      record,
      String(prop(node, 'labelField', '') ?? ''),
      String(prop(node, 'valueField', '') ?? '')
    )
  )
  const title = $derived(String(prop(node, 'title', '') ?? ''))
  const height = $derived(Math.min(480, Math.max(80, Number(prop(node, 'height', 200)) || 200)))

  const total = $derived(series.reduce((sum, point) => sum + Math.max(0, point.value), 0))

  const segments = $derived.by(() => {
    const base = total > 0 ? total : 1
    let offset = 0
    return series.map((point) => {
      const percent = (Math.max(0, point.value) / base) * 100
      const segment = { ...point, percent, offset }
      offset += percent
      return segment
    })
  })
</script>

{#if series.length === 0}
  <EmptyState
    icon="donut-line"
    title="No data yet"
    description={record
      ? `Add rows to “${recordLabel(record)}” to plot this chart.`
      : 'Bind a table or metric record to plot this chart.'}
  />
{:else}
  <div class="space-y-3">
    {#if title}
      <p class="text-[12.5px] font-medium">{title}</p>
    {/if}
    <div class="relative mx-auto w-full" style="max-width:{height}px; aspect-ratio:1 / 1;">
      <svg viewBox="0 0 42 42" class="size-full -rotate-90" role="img" aria-label={title || 'Donut chart'}>
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-secondary)" stroke-width="5" />
        {#each segments as segment, index (index)}
          <circle
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            style="stroke: var(--chart-{(index % 5) + 1})"
            stroke-width="5"
            stroke-dasharray={`${segment.percent} ${100 - segment.percent}`}
            stroke-dashoffset={-segment.offset}
          >
            <title>{segment.label}: {formatNumber(segment.value)}</title>
          </circle>
        {/each}
      </svg>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span class="text-[20px] font-semibold leading-none tabular-nums">{formatNumber(total)}</span>
        <span class="mt-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">Total</span>
      </div>
    </div>
    <ul class="grid grid-cols-2 gap-x-4 gap-y-1">
      {#each segments as segment, index (index)}
        <li class="flex min-w-0 items-center gap-1.5 text-[11.5px]">
          <span class="size-2 shrink-0 rounded-full" style="background: var(--chart-{(index % 5) + 1})"></span>
          <span class="min-w-0 flex-1 truncate text-muted-foreground">{segment.label}</span>
          <span class="shrink-0 tabular-nums">{Math.round(segment.percent)}%</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
