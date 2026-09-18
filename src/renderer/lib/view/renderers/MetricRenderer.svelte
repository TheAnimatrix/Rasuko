<script lang="ts">
  import type { ContentRecord, TableCellValue, ViewNode } from '@shared/types'
  import { cn, formatNumber } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { bindingRecord, prop, toneAccent } from '../props'
  import TypedField from '../TypedField.svelte'
  import { runQueuedRecordAction } from '../recordActionQueue'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const metric = $derived(record && record.kind === 'metric' ? record : null)
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))

  const label = $derived(record?.label?.trim() || String(prop(node, 'label', 'Metric') ?? ''))
  const format = $derived(
    (metric?.format ?? String(prop(node, 'format', 'number'))) as
      | 'number'
      | 'percent'
      | 'currency'
  )
  const unit = $derived(metric?.unit ?? String(prop(node, 'unit', '') ?? ''))
  const trend = $derived(String(prop(node, 'trend', 'none')))
  const icon = $derived(String(prop(node, 'icon', '') ?? ''))
  const tone = $derived(prop(node, 'tone', 'neutral'))
  const valueField = $derived({ id: 'value', name: label, type: 'number' as const })
  let error = $state('')

  const delta = $derived.by(() => {
    if (!metric || metric.previous === undefined || metric.previous === 0) return null
    return ((metric.value - metric.previous) / Math.abs(metric.previous)) * 100
  })

  const spark = $derived.by(() => {
    const series = metric?.series ?? []
    if (series.length < 2) return ''
    const values = series.map((point) => Number(point.value))
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    return values
      .map((value, index) => `${(index / (values.length - 1)) * 100},${34 - ((value - min) / span) * 30}`)
      .join(' ')
  })

  async function saveValue(value: TableCellValue): Promise<void> {
    if (!canEdit || !metric) return
    if (typeof value !== 'number') throw new Error('Metric requires a number')
    error = ''
    try { await runQueuedRecordAction(metric.id, { type: 'metric.set', value }, workspace.payload?.page.projectId) }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not save this metric.'; throw reason }
  }
</script>

<div class="rounded-xl border border-border bg-card px-3.5 py-3">
  <div class="flex items-center gap-2">
    {#if icon}
      <span
        class={cn('flex size-5 shrink-0 items-center justify-center rounded-md', toneAccent(tone))}
      >
        <Icon name={icon} size={12} />
      </span>
    {/if}
    <span class="truncate text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  </div>
  <div class="mt-2 flex items-end justify-between gap-2">
    <div class="min-w-0">
      {#if canEdit && metric}
        <TypedField column={valueField} value={metric.value} class="w-28 border-0 px-0 text-[26px] font-semibold leading-none tracking-tight" onchange={saveValue} />
      {:else}
        <span class="text-[26px] font-semibold leading-none tracking-tight">
          {metric ? formatNumber(metric.value, format) : '—'}
        </span>
      {/if}
      {#if unit}
        <span class="ml-1 text-[12.5px] text-muted-foreground">{unit}</span>
      {/if}
    </div>
    {#if trend !== 'none'}
      <span
        class={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
          trend === 'up' ? 'bg-success/12 text-success' : 'bg-destructive/12 text-destructive'
        )}
      >
        <Icon name={trend === 'up' ? 'arrow-up-line' : 'arrow-down-line'} size={11} />
        {#if delta !== null}{Math.abs(Math.round(delta))}%{/if}
      </span>
    {/if}
  </div>
  {#if error}<p class="mt-1 text-[11px] text-destructive" role="alert">{error}</p>{/if}
  {#if spark}
    <svg viewBox="0 0 100 36" class="mt-2 h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={spark}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        class={tone === 'neutral' ? 'text-muted-foreground/60' : tone === 'info' ? 'text-info' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-destructive'}
      />
    </svg>
  {/if}
</div>
