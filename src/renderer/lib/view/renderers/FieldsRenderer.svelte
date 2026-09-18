<script lang="ts">
  import type { ContentRecord, FieldsRecord, ViewNode } from '@shared/types'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import FormFields from '../FormFields.svelte'
  import { bindingRecord, prop, recordLabel } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const form = $derived(record && record.kind === 'fields' ? (record as FieldsRecord) : null)
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))

  const layout = $derived(prop(node, 'layout', 'stack') as 'stack' | 'inline')
  const submitLabel = $derived(String(prop(node, 'submitLabel', '') ?? ''))
</script>

{#if form}
  <FormFields
    record={form}
    editable={canEdit}
    {layout}
    {submitLabel}
    fieldId={node.bind?.field}
    mode={node.bind?.mode}
  />
{:else}
  <EmptyState
    icon="edit-line"
    title="No form bound"
    description={record
      ? `“${recordLabel(record)}” is not a fields record. Reassign one to capture data.`
      : 'Bind a fields record to render a form.'}
  />
{/if}
