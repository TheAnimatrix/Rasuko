<script lang="ts">
  import type { TableCellValue, TableRecord } from '@shared/types'
  import type { RecordAction } from '@shared/recordActions'
  import { workspace } from '$lib/stores/workspace.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import TypedField from './TypedField.svelte'
  import { runQueuedRecordAction } from './recordActionQueue'

  interface Props {
    record: TableRecord
    rowId: string
    editable?: boolean
    onclose?: () => void
  }

  let { record, rowId, editable = true, onclose }: Props = $props()
  const row = $derived(record.rows.find((candidate) => candidate.id === rowId))
  const projectId = $derived(workspace.payload?.page.projectId)
  let error = $state(''), inFlight = $state(0)
  const busy = $derived(inFlight > 0)

  async function act(action: RecordAction, propagate = false): Promise<void> {
    if (!editable) return
    const target = { recordId: record.id, projectId }
    inFlight += 1; error = ''
    const operation = runQueuedRecordAction(target.recordId, action, target.projectId).then(() => undefined)
    try { await operation }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not update this record.'; if (propagate) throw reason }
    finally { inFlight -= 1 }
  }


  function setCell(columnId: string, value: TableCellValue): Promise<void> {
    return act({ type: 'row.update', rowId, cells: { [columnId]: value } }, true)
  }
  async function finish(action: RecordAction): Promise<void> {
    await act(action)
    if (!error) onclose?.()
  }
</script>

{#if row}
  <div class="space-y-3">
    <div class="grid gap-3 sm:grid-cols-2">
      {#each record.columns as column (column.id)}
        <label class="space-y-1">
          <span class="text-[11.5px] font-medium text-muted-foreground">{column.name}</span>
          <TypedField {column} value={row.cells[column.id]} {editable} onchange={(value) => setCell(column.id, value)} />
        </label>
      {/each}
    </div>
    {#if error}<p class="text-[12px] text-destructive" role="alert">{error}</p>{/if}
    {#if editable}
      <div class="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={busy} onclick={() => void act({ type: 'row.duplicate', rowId })}>Duplicate</Button>
        <Button size="sm" variant="outline" disabled={busy} onclick={() => void finish({ type: 'row.archive', rowId, archived: true })}>Archive</Button>
        <Button size="sm" variant="destructive" disabled={busy} onclick={() => void finish({ type: 'row.delete', rowId })}>Delete</Button>
      </div>
    {/if}
  </div>
{:else}
  <p class="text-[12.5px] text-muted-foreground">This row is no longer available.</p>
{/if}
