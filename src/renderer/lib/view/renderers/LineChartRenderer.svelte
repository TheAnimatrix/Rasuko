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
  const area = $derived(Boolean(prop(node, 'area', true)))
  const height = $derived(Math.min(480, Math.max(80, Number(prop(node, 'height', 200)) || 200)))

  const geometry = $derived.by(() => {
    if (series.length === 0) return { path: '', areaPath: '', points: [] as Array<{ x: number; y: number; point: (typeof series)[number] }> }
    const values = series.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const count = series.length
    const points = series.map((point, index) => {
      const x = count === 1 ? 50 : (index / (count - 1)) * 100
      const y = 36 - ((point.value - min) / span) * 32
      return { x, y, point }
    })
    const path = points
      .map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ')
    const areaPath = `${path} L ${points[points.length - 1].x.toFixed(2)} 38 L ${points[0].x.toFixed(2)} 38 Z`
    return { path, areaPath, points }
  })
</script>

{#if series.length === 0}
  <EmptyState
    icon="chart-line-line"
    title="No data yet"
    description={record
      ? `Add rows to “${recordLabel(record)}” to plot this chart.`
      : 'Bind a table or metric record to plot this chart.'}
  />
{:else}
  <div class="space-y-1.5">
    {#if title}
      <p class="text-[12.5px] font-medium">{title}</p>
    {/if}
    <svg
      viewBox="0 0 100 38"
      preserveAspectRatio="none"
      class="w-full"
      style="height:{height}px;"
      role="img"
      aria-label={title || 'Line chart'}
    >
      {#each [8, 16, 24, 32] as y (y)}
        <line x1="0" y1={y} x2="100" y2={y} stroke="var(--color-border)" stroke-width="0.3" />
      {/each}
      <line x1="0" y1="38" x2="100" y2="38" stroke="var(--color-border)" stroke-width="0.5" />
      {#if area}
        <path d={geometry.areaPath} fill="var(--chart-1)" opacity="0.12" stroke="none" />
      {/if}
      <path
        d={geometry.path}
        fill="none"
        stroke="var(--chart-1)"
        stroke-width="0.9"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      {#each geometry.points as entry, index (index)}
        <circle cx={entry.x} cy={entry.y} r="1" fill="var(--chart-1)" vector-effect="non-scaling-stroke">
          <title>{entry.point.label}: {formatNumber(entry.point.value)}</title>
        </circle>
      {/each}
    </svg>
    <div class="flex justify-between gap-2 text-[10.5px] text-muted-foreground">
      <span class="truncate">{series[0].label}</span>
      {#if series.length > 2}
        <span class="truncate">{series[Math.floor(series.length / 2)].label}</span>
      {/if}
      <span class="truncate">{series[series.length - 1].label}</span>
    </div>
  </div>
{/if}
