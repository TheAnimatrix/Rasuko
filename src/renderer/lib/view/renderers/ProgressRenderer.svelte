<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn, clamp, formatNumber } from '$lib/utils'
  import { bindingRecord, prop, recordLabel, tableRows } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const label = $derived(
    String(prop(node, 'label', '') ?? '') || (record ? recordLabel(record) : 'Progress')
  )
  const target = $derived(Math.max(0, Number(prop(node, 'target', 100)) || 0))
  const tone = $derived(String(prop(node, 'tone', 'neutral')))

  const metrics = $derived.by(() => {
    if (!record) return { value: 0, max: target || 100 }
    if (record.kind === 'metric') {
      return { value: Number(record.value) || 0, max: Number(record.target ?? target) || 0 }
    }
    if (record.kind === 'list') {
      return {
        value: record.items.filter((item) => item.done).length,
        max: record.items.length
      }
    }
    if (record.kind === 'table') {
      const { rows } = tableRows(record)
      return { value: rows.length, max: target || rows.length }
    }
    return { value: 0, max: target || 100 }
  })

  const percent = $derived(clamp(metrics.max > 0 ? (metrics.value / metrics.max) * 100 : 0, 0, 100))

  const FILL: Record<string, string> = {
    neutral: 'bg-primary',
    info: 'bg-info',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-destructive'
  }
</script>

<div class="space-y-1.5">
  <div class="flex items-center justify-between gap-2">
    <span class="truncate text-[12.5px] font-medium">{label}</span>
    <span class="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
      {formatNumber(metrics.value)}/{formatNumber(metrics.max || 100)}
    </span>
  </div>
  <div class="h-2 overflow-hidden rounded-full bg-secondary">
    <div
      class={cn('h-full rounded-full transition-all', FILL[tone] ?? FILL.neutral)}
      style="width:{percent}%"
    ></div>
  </div>
</div>
