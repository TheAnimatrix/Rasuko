<script lang="ts">
  /**
   * ToolRow — 21st.dev Agent Elements dispatcher.
   *
   * Mirrors Mousse's ToolRenderer: specialised cards for the tools that carry
   * structure (search, file writes, view redesigns), the thinking row for
   * reasoning, and a generic row for everything else.
   */

  import type { ChatToolCall } from '@shared/types'
  import { basename, isPending, stringArg, truncate } from './format'
  import GenericToolRow from './GenericToolRow.svelte'
  import SearchRow from './SearchRow.svelte'
  import EditRow from './EditRow.svelte'
  import PlanRow from './PlanRow.svelte'

  interface Props {
    call: ChatToolCall
  }

  let { call }: Props = $props()

  const pending = $derived(isPending(call))
  const input = $derived(call.input ?? {})
  /**
   * Tool ids are dotted internally (`view.applyOps`) but shipped to providers
   * underscored (`view_applyOps`) — normalize so transcripts from either era
   * dispatch to the same card.
   */
  const toolName = $derived((call.name ?? '').replace(/\./g, '_'))

  const generic = $derived.by<{
    icon: string
    label: string
    pendingLabel?: string
    subtitle?: string
  } | null>(() => {
    switch (toolName) {
      case 'view_get':
        return { icon: 'file-line', label: 'Read view', subtitle: 'current page tree' }
      case 'record_create':
        return {
          icon: 'layers-line',
          label: 'Created record',
          pendingLabel: 'Creating record',
          subtitle:
            stringArg(input, 'label') ||
            (stringArg(input, 'kind') ? `${stringArg(input, 'kind')} record` : undefined)
        }
      case 'record_update':
        return {
          icon: 'edit-2-line',
          label: 'Updated record',
          pendingLabel: 'Updating record',
          subtitle: truncate(stringArg(input, 'recordId'), 32)
        }
      case 'record_list':
        return { icon: 'list-ordered-line', label: 'Listed records' }
      case 'page_info':
        return { icon: 'folder-line', label: 'Read workspace' }
      default:
        return null
    }
  })
</script>

{#if toolName === 'read' || toolName === 'grep' || toolName === 'ls'}
  <SearchRow {call} />
{:else if toolName === 'write'}
  <EditRow {call} />
{:else if toolName === 'view_applyOps'}
  <PlanRow {call} />
{:else if generic}
  <GenericToolRow
    icon={generic.icon}
    label={generic.label}
    pendingLabel={generic.pendingLabel}
    subtitle={generic.subtitle}
    {pending}
  />
{:else}
  <GenericToolRow
    icon="box-line"
    label={call.name}
    pendingLabel={`Running ${call.name}`}
    subtitle={basename(stringArg(input, 'path')) || undefined}
    {pending}
  />
{/if}
