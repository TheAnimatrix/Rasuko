<script lang="ts">
  import type { TableCellValue, TableColumn, TableRecord } from '@shared/types'
  import type { RecordAction } from '@shared/recordActions'
  import { queryTable } from '@shared/tableQuery'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { cn } from '$lib/utils'
  import Button from '$lib/components/ui/Button.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import TypedField from './TypedField.svelte'
  import RecordDetailEditor from './RecordDetailEditor.svelte'
  import { runQueuedRecordAction, undoQueuedRecordAction } from './recordActionQueue'

  interface Props { record: TableRecord; columns?: TableColumn[]; editable?: boolean; density?: 'compact' | 'cozy'; striped?: boolean; showFooter?: boolean }
  let { record, columns, editable = true, density = 'cozy', striped = false, showFooter = false }: Props = $props()
  const displayColumns = $derived(columns ?? record.columns)
  let sortKey = $state<string | null>(null), sortDir = $state<1 | -1>(1), search = $state(''), showArchived = $state(false)
  let detailRowId = $state<string | null>(null), detailOpen = $state(false), error = $state(''), inFlight = $state(0)
  const busy = $derived(inFlight > 0)
  const projectId = $derived(workspace.payload?.page.projectId)
  const rows = $derived(queryTable(record, { archived: 'exclude' }))
  const archivedRows = $derived(queryTable(record, { archived: 'only' }))

  function toggleSort(id: string): void { if (sortKey === id) sortDir = sortDir === 1 ? -1 : 1; else { sortKey = id; sortDir = 1 } }
  const displayRows = $derived.by(() => {
    const needle = search.trim().toLocaleLowerCase()
    let result = needle ? rows.filter((row) => displayColumns.some((column) => String(row.cells[column.id] ?? '').toLocaleLowerCase().includes(needle))) : rows
    if (!sortKey) return result
    const key = sortKey, column = displayColumns.find((candidate) => candidate.id === key)
    result = [...result].sort((a, b) => {
      const av = a.cells[key], bv = b.cells[key]
      const cmp = column?.type === 'number' ? Number(av ?? 0) - Number(bv ?? 0) : column?.type === 'checkbox' ? Number(Boolean(av)) - Number(Boolean(bv)) : String(av ?? '').localeCompare(String(bv ?? ''))
      return cmp * sortDir
    })
    return result
  })

  async function act(action: RecordAction, propagate = false): Promise<void> {
    if (!editable) return
    const target = { recordId: record.id, projectId }
    inFlight += 1; error = ''
    const operation = runQueuedRecordAction(target.recordId, action, target.projectId).then(() => undefined)
    try { await operation }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not update this table.'; if (propagate) throw reason }
    finally { inFlight -= 1 }
  }
  function setCell(rowId: string, columnId: string, value: TableCellValue): Promise<void> { return act({ type: 'row.update', rowId, cells: { [columnId]: value } }, true) }
  function addRow(): void {
    void act({ type: 'row.create' })
  }
  async function undo(): Promise<void> { const target = { recordId: record.id, projectId }; error = ''; try { await undoQueuedRecordAction(target.recordId, target.projectId) } catch (reason) { error = reason instanceof Error ? reason.message : 'Could not undo the last change.' } }
  const numericColumns = $derived(displayColumns.filter((column) => column.type === 'number'))
  function total(columnId: string): number { return rows.reduce((sum, row) => sum + (Number(row.cells[columnId]) || 0), 0) }
  const cellPad = $derived(density === 'compact' ? 'px-1.5 py-0.5' : 'px-2 py-1.5')
</script>

<div class="mb-2 flex flex-wrap items-center gap-2">
  <input class="h-7 min-w-40 flex-1 rounded-md border border-input bg-background px-2 text-[12.5px] outline-none focus:border-ring" bind:value={search} placeholder="Search rows…" aria-label="Search rows" />
  <Button size="sm" variant={showArchived ? 'secondary' : 'ghost'} onclick={() => showArchived = !showArchived}>Archived {archivedRows.length}</Button>
  {#if editable}<Button size="sm" variant="ghost" disabled={busy} onclick={() => void undo()}>Undo</Button>{/if}
</div>
{#if error}<p class="mb-2 text-[12px] text-destructive" role="alert">{error}</p>{/if}
<div class="overflow-x-auto rounded-xl border border-border scrollbar-thin"><table class="w-full border-collapse text-[13px]">
  <thead class="sticky top-0 z-10 bg-secondary/90 backdrop-blur"><tr>
    {#each displayColumns as column (column.id)}<th class={cn('border-b border-border text-left font-medium', density === 'compact' ? 'px-1.5 py-1.5' : 'px-2 py-2')}><button type="button" class="text-[12px] text-muted-foreground hover:text-foreground" onclick={() => toggleSort(column.id)}>{column.name}{sortKey === column.id ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}</button></th>{/each}
    {#if editable}<th class="w-36 border-b border-border"></th>{/if}
  </tr></thead>
  <tbody>
    {#each displayRows as row (row.id)}<tr class={cn('border-b border-border last:border-0', striped && 'odd:bg-secondary/25')}>
      {#each displayColumns as column (column.id)}<td class={cn('align-top', cellPad)}><TypedField {column} value={row.cells[column.id]} {editable} compact={density === 'compact'} onchange={(value) => setCell(row.id, column.id, value)} /></td>{/each}
      {#if editable}<td class={cn('whitespace-nowrap text-right align-top', cellPad)}>
        <button class="px-1 text-[11px] text-muted-foreground hover:text-foreground" onclick={() => { detailRowId = row.id; detailOpen = true }}>Details</button>
        <button class="px-1 text-[11px] text-muted-foreground hover:text-foreground" onclick={() => void act({ type: 'row.duplicate', rowId: row.id })}>Copy</button>
        <button class="px-1 text-[11px] text-muted-foreground hover:text-foreground" onclick={() => void act({ type: 'row.archive', rowId: row.id, archived: true })}>Archive</button>
      </td>{/if}
    </tr>{:else}<tr><td class="px-3 py-6 text-center text-[12.5px] text-muted-foreground" colspan={displayColumns.length + (editable ? 1 : 0)}>No matching rows</td></tr>{/each}
  </tbody>
  {#if showFooter && numericColumns.length > 0}<tfoot class="bg-secondary/50"><tr>{#each displayColumns as column, index (column.id)}{#if index === 0}<td class="px-2 py-1.5 text-[11px] uppercase text-muted-foreground">Total</td>{:else if numericColumns.includes(column)}<td class="px-2 py-1.5 tabular-nums">{total(column.id)}</td>{:else}<td></td>{/if}{/each}{#if editable}<td></td>{/if}</tr></tfoot>{/if}
</table></div>
{#if editable}<div class="mt-1.5"><Button variant="ghost" size="sm" disabled={busy} onclick={addRow}>Add row</Button></div>{/if}
{#if showArchived}<div class="mt-3 rounded-lg border border-border p-2"><p class="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Archived rows</p>{#each archivedRows as row (row.id)}<div class="flex items-center gap-2 py-1 text-[12px]"><span class="min-w-0 flex-1 truncate">{String(row.cells[record.columns[0]?.id] ?? 'Untitled')}</span>{#if editable}<button class="text-primary" onclick={() => void act({ type: 'row.archive', rowId: row.id, archived: false })}>Restore</button><button class="text-destructive" onclick={() => void act({ type: 'row.delete', rowId: row.id })}>Delete</button>{/if}</div>{:else}<p class="text-[12px] text-muted-foreground">No archived rows</p>{/each}</div>{/if}
<Dialog bind:open={detailOpen} title="Edit record" description="Edit every field or manage this row.">{#if detailRowId}<RecordDetailEditor {record} rowId={detailRowId} {editable} onclose={() => detailOpen = false} />{/if}</Dialog>
