<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import { cn, formatNumber } from '$lib/utils'
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
  const stacked = $derived(Boolean(prop(node, 'stacked', false)))
  const height = $derived(Math.min(480, Math.max(80, Number(prop(node, 'height', 200)) || 200)))

  const max = $derived(Math.max(1, ...series.map((point) => Math.abs(point.value))))
</script>

{#if series.length === 0}
  <EmptyState
    icon="chart-bar-line"
    title="No data yet"
    description={record
      ? `Add rows to “${recordLabel(record)}” to plot this chart.`
      : 'Bind a table or metric record to plot this chart.'}
  />
{:else}
  <div class="space-y-2">
    {#if title}
      <p class="text-[12.5px] font-medium">{title}</p>
    {/if}
    <div class="flex items-end gap-2" style="height:{height}px;">
      {#each series as point, index (index)}
        <div class="group/bar flex h-full min-w-0 flex-1 flex-col justify-end">
          <span
            class="mb-1 truncate text-center text-[10.5px] tabular-nums text-muted-foreground"
          >
            {formatNumber(point.value)}
          </span>
          {#if stacked}
            <div class="relative w-full flex-1 overflow-hidden rounded-t bg-secondary">
              <div
                class="absolute inset-x-0 bottom-0 rounded-t"
                style="height:{Math.max(1, (Math.abs(point.value) / max) * 100)}%; background: var(--chart-{(index % 5) + 1})"
              ></div>
            </div>
          {:else}
            <div
              class="w-full rounded-t transition-[height]"
              style="height:{Math.max(1, (Math.abs(point.value) / max) * 100)}%; background: var(--chart-{(index % 5) + 1})"
            ></div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="flex gap-2">
      {#each series as point, index (index)}
        <span class={cn('min-w-0 flex-1 truncate text-center text-[10.5px] text-muted-foreground')}>
          {point.label}
        </span>
      {/each}
    </div>
  </div>
{/if}
