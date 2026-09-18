<script lang="ts">
  import type { ContentRecord, TableCellValue, TableRecord, ViewNode } from '@shared/types'
  import type { RecordAction } from '@shared/recordActions'
  import { groupRows, queryTable, type TableQuery } from '@shared/tableQuery'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import Badge from '$lib/components/ui/Badge.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import { workspace } from '$lib/stores/workspace.svelte'
  import RecordDetailEditor from '../RecordDetailEditor.svelte'
  import RecordCreateEditor from '../RecordCreateEditor.svelte'
  import TypedField from '../TypedField.svelte'
  import { runQueuedRecordAction, undoQueuedRecordAction } from '../recordActionQueue'
  import { bindingRecord, prop, recordLabel } from '../props'

  interface Props { node: ViewNode; records: Record<string, ContentRecord>; editable?: boolean }
  let { node, records, editable = true }: Props = $props()
  const record = $derived(bindingRecord(records, node.bind))
  const table = $derived(record?.kind === 'table' ? record : null)
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))
  const groupBy = $derived(String(prop(node, 'groupBy', '') ?? ''))
  const titleField = $derived(String(prop(node, 'titleField', '') ?? ''))
  const showSearch = $derived(Boolean(prop(node, 'showSearch', true)))
  const showCounts = $derived(Boolean(prop(node, 'showCounts', true)))
  const wipLimit = $derived(Math.max(0, Number(prop(node, 'wipLimit', 0)) || 0))
  const projectId = $derived(workspace.payload?.page.projectId)
  const columns = $derived(table?.columns ?? [])
  const rows = $derived(table ? queryTable(table, { archived: 'exclude' }) : [])
  const archivedRows = $derived(table ? queryTable(table, { archived: 'only' }) : [])
  const groupColumn = $derived(columns.find((column) => column.name === groupBy || column.id === groupBy) ?? columns.find((column) => column.type === 'select') ?? columns[0])
  const titleColumn = $derived(columns.find((column) => column.name === titleField || column.id === titleField) ?? columns.find((column) => column.id !== groupColumn?.id))

  let search = $state(''), filterField = $state(''), filterValue = $state(''), sortField = $state(''), sortDirection = $state<'asc' | 'desc'>('asc')
  let error = $state(''), inFlight = $state(0), draggedRowId = $state<string | null>(null), showArchived = $state(false)
  const busy = $derived(inFlight > 0)
  let detailRowId = $state<string | null>(null), detailOpen = $state(false)
  let createOpen = $state(false), createGroup = $state<TableCellValue>(null), createRevision = $state(0)
  let laneDraft = $state(''), editingLane = $state<string | null>(null), laneEdit = $state('')
  let removeLaneValue = $state<string | null>(null), removeLaneTarget = $state(''), removeLaneOpen = $state(false)

  const query = $derived.by<TableQuery>(() => ({
    search,
    archived: 'exclude',
    filters: filterField && filterValue ? [{ field: filterField, op: 'contains', value: filterValue }] : [],
    sort: sortField ? [{ field: sortField, direction: sortDirection }] : []
  }))
  type BoardGroup = { key: string; value: TableCellValue; label: string; rows: TableRecord['rows']; total: number }
  function keyFor(value: TableCellValue): string { return value === null || value === '' ? 'empty:' : `${typeof value}:${String(value)}` }
  function labelFor(value: TableCellValue): string { return value === null || value === '' ? 'No status' : String(value) }
  function projectedGroups(source: TableRecord, request: TableQuery): BoardGroup[] {
    if (!groupColumn) return []
    const full = new Map<string, number>()
    for (const group of groupRows(source, groupColumn.id, { archived: 'exclude' })) {
      const key = keyFor(group.value); full.set(key, (full.get(key) ?? 0) + group.rows.length)
    }
    const merged = new Map<string, BoardGroup>()
    for (const group of groupRows(source, groupColumn.id, request)) {
      const value = group.value === '' ? null : group.value, key = keyFor(value)
      const current = merged.get(key)
      if (current) current.rows.push(...group.rows)
      else merged.set(key, { key, value, label: labelFor(value), rows: [...group.rows], total: full.get(key) ?? 0 })
    }
    if (merged.size === 0) merged.set('empty:', { key: 'empty:', value: null, label: 'No status', rows: [], total: full.get('empty:') ?? 0 })
    return [...merged.values()]
  }
  const groups = $derived(table ? projectedGroups(table, query) : [])

  async function act(action: RecordAction, propagate = false): Promise<void> {
    if (!canEdit || !table) return
    const target = { recordId: table.id, projectId }
    inFlight += 1; error = ''
    const operation = runQueuedRecordAction(target.recordId, action, target.projectId).then(() => undefined)
    try { await operation }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not update this board.'; if (propagate) throw reason }
    finally { inFlight -= 1 }
  }
  function addTask(value: TableCellValue): void {
    if (!table || !groupColumn) return
    createGroup = value
    createRevision += 1
    createOpen = true
  }
  function move(rowId: string, value: TableCellValue, beforeRowId?: string): void {
    if (!groupColumn) return
    void act({ type: 'row.move', rowId, groupField: groupColumn.id, groupValue: value, beforeRowId })
  }
  function reorder(rowId: string, key: string, delta: number): void {
    const group = groups.find((candidate) => candidate.key === key)
    if (!group) return
    const index = group.rows.findIndex((row) => row.id === rowId), target = index + delta
    if (target < 0 || target >= group.rows.length) return
    const beforeRowId = delta < 0 ? group.rows[target].id : group.rows[target + 1]?.id
    move(rowId, group.value, beforeRowId)
  }
  function laneOptions(): string[] { return [...(groupColumn?.options ?? rows.map((row) => String(row.cells[groupColumn?.id ?? ''] ?? '')).filter(Boolean))].filter((value, index, all) => all.indexOf(value) === index) }
  function addLane(): void {
    const name = laneDraft.trim(); if (!groupColumn || !name) return
    const options = laneOptions(); if (options.includes(name)) return
    laneDraft = ''; void act({ type: 'column.options', columnId: groupColumn.id, options: [...options, name] })
  }
  function renameLane(from: string): void {
    if (editingLane !== from) return
    const to = laneEdit.trim(); if (!groupColumn || !to || to === from) { editingLane = null; return }
    const options = laneOptions().map((option) => option === from ? to : option)
    editingLane = null; void act({ type: 'column.options', columnId: groupColumn.id, options, rename: { from, to } })
  }
  function moveLane(label: string, delta: number): void {
    if (!groupColumn) return
    const options = laneOptions(), index = options.indexOf(label), target = index + delta
    if (index < 0 || target < 0 || target >= options.length) return
    ;[options[index], options[target]] = [options[target], options[index]]
    void act({ type: 'column.options', columnId: groupColumn.id, options })
  }
  function requestRemoveLane(label: string): void {
    if (!groupColumn) return
    const populated = rows.some((row) => row.cells[groupColumn.id] === label)
    if (!populated) { removeLane(label, ''); return }
    removeLaneValue = label; removeLaneTarget = ''; removeLaneOpen = true
  }
  function removeLane(label: string, destination: string): void {
    if (!groupColumn) return
    const options = laneOptions().filter((option) => option !== label)
    if (rows.some((row) => row.cells[groupColumn.id] === label) && !destination) return
    removeLaneOpen = false
    void act({ type: 'column.options', columnId: groupColumn.id, options, removedValue: label, reassignTo: destination })
  }
  function configureLegacyOptions(): void {
    if (!groupColumn) return
    const options = laneOptions()
    void act({ type: 'column.options', columnId: groupColumn.id, options })
  }
  async function undo(): Promise<void> {
    if (!table) return
    const target = { recordId: table.id, projectId }
    error = ''; try { await undoQueuedRecordAction(target.recordId, target.projectId) } catch (reason) { error = reason instanceof Error ? reason.message : 'Could not undo the last change.' }
  }
</script>

{#if !table || columns.length === 0}
  <EmptyState icon="grid-2-line" title="No board data" description={record ? `No columns yet in “${recordLabel(record)}”.` : 'Bind a table record with a status column to build a board.'} />
{:else}
  <div class="mb-2 flex flex-wrap items-center gap-2">
    {#if showSearch}<input class="h-7 min-w-40 flex-1 rounded-md border border-input bg-background px-2 text-[12.5px] outline-none focus:border-ring" bind:value={search} placeholder="Search cards…" aria-label="Search cards" />{/if}
    <select class="h-7 rounded-md border border-input bg-background px-1.5 text-[11.5px]" bind:value={filterField} aria-label="Filter field"><option value="">All fields</option>{#each columns as column (column.id)}<option value={column.id}>{column.name}</option>{/each}</select>
    {#if filterField}<input class="h-7 w-28 rounded-md border border-input bg-background px-2 text-[11.5px]" bind:value={filterValue} placeholder="Filter…" aria-label="Filter value" />{/if}
    <select class="h-7 rounded-md border border-input bg-background px-1.5 text-[11.5px]" bind:value={sortField} aria-label="Sort field"><option value="">Record order</option>{#each columns as column (column.id)}<option value={column.id}>{column.name}</option>{/each}</select>
    {#if sortField}<button class="h-7 rounded-md px-2 text-[11.5px] hover:bg-accent" onclick={() => sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'}>{sortDirection === 'asc' ? '↑' : '↓'}</button>{/if}
    <Button size="sm" variant={showArchived ? 'secondary' : 'ghost'} onclick={() => showArchived = !showArchived}>Archived {archivedRows.length}</Button>
    {#if canEdit}<Button size="sm" variant="ghost" disabled={busy} onclick={() => void undo()}>Undo</Button>{/if}
  </div>
  {#if error}<p class="mb-2 text-[12px] text-destructive" role="alert">{error}</p>{/if}
  <div class="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
    {#each groups as group, laneIndex (group.key)}
      <section class="flex w-56 shrink-0 flex-col gap-2" aria-label={group.label} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); if (draggedRowId) move(draggedRowId, group.value); draggedRowId = null }}>
        <div class="flex min-h-7 items-center gap-1 px-0.5">
          {#if editingLane === group.label}
            <input class="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-[12px]" bind:value={laneEdit} onkeydown={(event) => { if (event.key === 'Enter') renameLane(group.label); if (event.key === 'Escape') editingLane = null }} onblur={() => renameLane(group.label)} aria-label="Lane name" />
          {:else}<Badge tone={wipLimit && group.total > wipLimit ? 'danger' : 'neutral'}>{group.label}</Badge>{/if}
          {#if showCounts}<span class="text-[11px] tabular-nums text-muted-foreground">{group.total}{wipLimit ? `/${wipLimit}` : ''}</span>{/if}
          {#if canEdit && groupColumn?.options?.includes(group.label)}
            <div class="ml-auto flex"><button class="px-1 text-[11px] text-muted-foreground" disabled={laneIndex === 0} onclick={() => moveLane(group.label, -1)} aria-label="Move lane left">←</button><button class="px-1 text-[11px] text-muted-foreground" onclick={() => { editingLane = group.label; laneEdit = group.label }} aria-label="Rename lane">✎</button><button class="px-1 text-[11px] text-muted-foreground" onclick={() => requestRemoveLane(group.label)} aria-label="Remove lane">×</button><button class="px-1 text-[11px] text-muted-foreground" disabled={laneIndex === groups.length - 1} onclick={() => moveLane(group.label, 1)} aria-label="Move lane right">→</button></div>
          {/if}
        </div>
        <div class="flex min-h-12 flex-col gap-1.5">
          {#each group.rows as row, rowIndex (row.id)}
            <article draggable={canEdit} class="rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm" ondragstart={() => draggedRowId = row.id} ondragend={() => draggedRowId = null} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.stopPropagation(); event.preventDefault(); if (draggedRowId && draggedRowId !== row.id) move(draggedRowId, group.value, row.id); draggedRowId = null }}>
              {#if titleColumn}<TypedField column={titleColumn} value={row.cells[titleColumn.id]} editable={canEdit} class="font-medium" onchange={(value) => act({ type: 'row.update', rowId: row.id, cells: { [titleColumn.id]: value } }, true)} />{/if}
              <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">{#each columns as column (column.id)}{#if column.id !== groupColumn?.id && column.id !== titleColumn?.id}<span class="text-[10.5px] text-muted-foreground">{column.name}: {String(row.cells[column.id] ?? '—')}</span>{/if}{/each}</div>
              {#if canEdit && groupColumn}<select class="mt-2 h-6 w-full rounded border border-border bg-background px-1.5 text-[11px]" value={String(row.cells[groupColumn.id] ?? '')} aria-label="Move card" onchange={(event) => move(row.id, event.currentTarget.value || null)}><option value="">No status</option>{#each laneOptions() as option (option)}<option value={option}>{option}</option>{/each}</select>{/if}
              <div class="mt-1 flex items-center gap-1"><button class="text-[10.5px] text-muted-foreground hover:text-foreground" onclick={() => { detailRowId = row.id; detailOpen = true }}>Details</button>{#if canEdit}<button class="ml-auto px-1 text-[11px] text-muted-foreground" disabled={rowIndex === 0} onclick={() => reorder(row.id, group.key, -1)} aria-label="Move card up">↑</button><button class="px-1 text-[11px] text-muted-foreground" disabled={rowIndex === group.rows.length - 1} onclick={() => reorder(row.id, group.key, 1)} aria-label="Move card down">↓</button><button class="text-[10.5px] text-muted-foreground" onclick={() => void act({ type: 'row.duplicate', rowId: row.id })}>Copy</button><button class="text-[10.5px] text-muted-foreground" onclick={() => void act({ type: 'row.archive', rowId: row.id, archived: true })}>Archive</button>{/if}</div>
            </article>
          {/each}
          {#if canEdit}<button type="button" class="rounded-md px-2 py-1.5 text-left text-[11.5px] text-muted-foreground hover:bg-accent" onclick={() => addTask(group.value)}>+ Add task</button>{/if}
        </div>
      </section>
    {/each}
    {#if canEdit && groupColumn?.type === 'select'}<div class="flex w-48 shrink-0 items-start gap-1"><input class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px]" bind:value={laneDraft} placeholder="New lane" onkeydown={(event) => event.key === 'Enter' && addLane()} /><button class="h-7 rounded-md px-2 text-[12px] hover:bg-accent" onclick={addLane}>Add</button></div>{:else if canEdit}<Button size="sm" variant="outline" onclick={configureLegacyOptions}>Configure lanes</Button>{/if}
  </div>
  {#if showArchived}<div class="mt-3 rounded-lg border border-border p-2"><p class="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Archived</p>{#each archivedRows as row (row.id)}<div class="flex items-center gap-2 py-1 text-[12px]"><span class="min-w-0 flex-1 truncate">{String(titleColumn ? row.cells[titleColumn.id] ?? 'Untitled' : 'Untitled')}</span>{#if canEdit}<button class="text-primary" onclick={() => void act({ type: 'row.archive', rowId: row.id, archived: false })}>Restore</button><button class="text-destructive" onclick={() => void act({ type: 'row.delete', rowId: row.id })}>Delete</button>{/if}</div>{:else}<p class="text-[12px] text-muted-foreground">No archived cards</p>{/each}</div>{/if}
  <Dialog bind:open={detailOpen} title="Edit card" description="Edit every field or manage this card.">{#if detailRowId}<RecordDetailEditor record={table} rowId={detailRowId} editable={canEdit} onclose={() => detailOpen = false} />{/if}</Dialog>
  <Dialog bind:open={createOpen} title="Create card" description="Set the card fields before adding it to this lane.">{#key createRevision}<RecordCreateEditor record={table} requiredFieldId={titleColumn?.id} initial={groupColumn ? { [groupColumn.id]: createGroup } : {}} oncreate={async (cells) => { await act({ type: 'row.create', cells }, true) }} oncancel={() => createOpen = false} />{/key}</Dialog>
  <Dialog bind:open={removeLaneOpen} title="Move cards before removing lane" description={`Choose where cards in “${removeLaneValue ?? ''}” should move.`}><div class="space-y-3"><select class="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px]" bind:value={removeLaneTarget}><option value="">Choose a destination…</option>{#each laneOptions().filter((option) => option !== removeLaneValue) as option (option)}<option value={option}>{option}</option>{/each}</select><div class="flex justify-end gap-2"><Button variant="ghost" onclick={() => removeLaneOpen = false}>Cancel</Button><Button variant="destructive" disabled={!removeLaneTarget} onclick={() => removeLaneValue && removeLane(removeLaneValue, removeLaneTarget)}>Remove lane</Button></div></div></Dialog>
{/if}
