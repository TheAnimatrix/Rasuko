<script lang="ts">
  import type { ContentRecord, TableRecord, ViewNode } from '@shared/types'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { chat } from '$lib/stores/chat.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { runQueuedRecordAction } from '../recordActionQueue'
  import { kindIcon, prop, recordLabel } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const label = $derived(String(prop(node, 'label', 'Action') ?? ''))
  const action = $derived(String(prop(node, 'action', 'prompt')))
  const prompt = $derived(String(prop(node, 'prompt', '') ?? ''))
  const variant = $derived(String(prop(node, 'variant', 'secondary')))
  const icon = $derived(String(prop(node, 'icon', '') ?? ''))
  const targetRecordId = $derived(String(prop(node, 'targetRecordId', node.bind?.recordId ?? '') ?? ''))
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))
  let error = $state('')

  const VARIANT: Record<string, 'default' | 'secondary' | 'ghost'> = {
    primary: 'default',
    secondary: 'secondary',
    ghost: 'ghost'
  }

  let pickerOpen = $state(false)

  const tableRecords = $derived(
    Object.values(records).filter((record): record is TableRecord => record.kind === 'table')
  )
  const targetTable = $derived(
    tableRecords.find((record) => record.id === targetRecordId)
  )

  async function addRowTo(record: TableRecord): Promise<void> {
    pickerOpen = false
    error = ''
    try { await runQueuedRecordAction(record.id, { type: 'row.create' }, workspace.payload?.page.projectId) }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not add the row.' }
  }

  function activate(): void {
    if (!canEdit) return
    if (action === 'prompt') {
      void chat.send(prompt || label)
      return
    }
    if (action === 'addRow') {
      if (targetTable) void addRowTo(targetTable)
      else if (tableRecords.length === 1) void addRowTo(tableRecords[0])
      else pickerOpen = true
    }
  }
</script>

<Button
  variant={VARIANT[variant] ?? 'secondary'}
  disabled={!canEdit}
  onclick={activate}
>
  {#if icon}
    <Icon name={icon} size={14} />
  {/if}
  {label}
</Button>
{#if error}<p class="mt-1 text-[12px] text-destructive" role="alert">{error}</p>{/if}

<Dialog
  bind:open={pickerOpen}
  title="Add a row to…"
  description="Choose the table record that should receive a new row."
>
  <div class="max-h-80 space-y-0.5 overflow-y-auto scrollbar-thin">
    {#each tableRecords as record (record.id)}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        onclick={() => void addRowTo(record)}
      >
        <Icon name={kindIcon(record.kind)} size={14} class="text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-[13px]">{recordLabel(record)}</span>
      </button>
    {:else}
      <p class="px-2 py-6 text-center text-[12.5px] text-muted-foreground">
        No table records on this page yet.
      </p>
    {/each}
  </div>
</Dialog>
