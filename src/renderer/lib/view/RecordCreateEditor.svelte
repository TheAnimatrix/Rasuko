<script lang="ts">
  import { untrack } from 'svelte'
  import type { TableCellValue, TableRecord } from '@shared/types'
  import Button from '$lib/components/ui/Button.svelte'
  import TypedField from './TypedField.svelte'
  import { flushEditors } from '$lib/flushEditors'

  interface Props {
    record: TableRecord
    initial?: Record<string, TableCellValue>
    requiredFieldId?: string
    oncreate: (cells: Record<string, TableCellValue>) => void | Promise<void>
    oncancel?: () => void
  }
  let { record, initial = {}, requiredFieldId, oncreate, oncancel }: Props = $props()
  let values = $state<Record<string, TableCellValue>>({ ...untrack(() => initial) })
  let busy = $state(false), error = $state('')
  const missingRequired = $derived(Boolean(requiredFieldId && !String(values[requiredFieldId] ?? '').trim()))
  function valueFor(column: TableRecord['columns'][number]): TableCellValue {
    return values[column.id] ?? (column.type === 'checkbox' ? false : null)
  }
  async function create(): Promise<void> {
    if (busy || missingRequired) return
    busy = true; error = ''
    try { await flushEditors(); await oncreate($state.snapshot(values)); oncancel?.() }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not create this record.' }
    finally { busy = false }
  }
</script>

<form class="space-y-3" onsubmit={(event) => { event.preventDefault(); void create() }}>
  <div class="grid gap-3 sm:grid-cols-2">
    {#each record.columns as column (column.id)}
      <label class="space-y-1"><span class="text-[11.5px] font-medium text-muted-foreground">{column.name}</span><TypedField {column} value={valueFor(column)} ondraft={(value) => { values = { ...values, [column.id]: value } }} onchange={(value) => { values = { ...values, [column.id]: value } }} /></label>
    {/each}
  </div>
  {#if error}<p class="text-[12px] text-destructive" role="alert">{error}</p>{/if}
  {#if missingRequired}<p class="text-[11.5px] text-muted-foreground">Enter {record.columns.find((column) => column.id === requiredFieldId)?.name || 'a title'} to create this record.</p>{/if}
  <div class="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onclick={oncancel}>Cancel</Button><Button type="submit" disabled={busy || missingRequired}>Create</Button></div>
</form>
