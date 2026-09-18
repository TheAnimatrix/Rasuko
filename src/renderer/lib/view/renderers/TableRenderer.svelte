<script lang="ts">
  import type { ContentRecord, TableRecord, ViewNode } from '@shared/types'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import DataTable from '../DataTable.svelte'
  import { bindingRecord, prop, recordLabel } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const table = $derived(record && record.kind === 'table' ? (record as TableRecord) : null)

  const displayColumns = $derived.by<TableRecord['columns']>(() => {
    if (!table) return []
    const wanted = prop<string[]>(node, 'columns', [])
    if (!wanted.length) return table.columns
    const columns = table.columns.filter((column) => wanted.includes(column.name))
    return columns.length > 0 ? columns : table.columns
  })

  const density = $derived(prop(node, 'density', 'cozy') as 'compact' | 'cozy')
  const striped = $derived(Boolean(prop(node, 'striped', false)))
  const showFooter = $derived(Boolean(prop(node, 'showFooter', false)))
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))
</script>

{#if table}
  <DataTable
    record={table}
    columns={displayColumns}
    editable={canEdit}
    {density}
    {striped}
    {showFooter}
  />
{:else}
  <EmptyState
    icon="table-line"
    title="No table bound"
    description={record
      ? `“${recordLabel(record)}” is not a table. Reassign a table record to this component.`
      : 'Bind a table record to show data here.'}
  />
{/if}
