<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import { blockPlainText } from '@shared/richtext'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { bindingRecord, prop } from '../props'
  import { runQueuedRecordAction } from '../recordActionQueue'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))
  const showProgress = $derived(Boolean(prop(node, 'showProgress', true)))
  let error = $state('')

  interface Item {
    id: string
    text: string
    done: boolean
  }

  const items = $derived.by<Item[]>(() => {
    if (!record) return []
    if (record.kind === 'list') {
      return record.items.map((item) => ({ id: item.id, text: item.text, done: Boolean(item.done) }))
    }
    if (record.kind === 'richtext') {
      return record.doc.blocks
        .filter((block) => block.type === 'todo')
        .map((block) => ({
          id: block.id,
          text: blockPlainText(block),
          done: Boolean((block as { checked?: boolean }).checked)
        }))
    }
    return []
  })

  const done = $derived(items.filter((item) => item.done).length)
  const percent = $derived(items.length === 0 ? 0 : Math.round((done / items.length) * 100))

  async function toggle(item: Item): Promise<void> {
    if (!canEdit || !record) return
    error = ''
    if (record.kind === 'list') {
      try { await runQueuedRecordAction(record.id, { type: 'list.update', itemId: item.id, done: !item.done }, workspace.payload?.page.projectId) }
      catch (reason) { error = reason instanceof Error ? reason.message : 'Could not update this item.' }
      return
    }
    if (record.kind === 'richtext') {
      try {
        const doc = $state.snapshot(record.doc)
        for (const block of doc.blocks) {
          if (block.id === item.id && block.type === 'todo') block.checked = !block.checked
        }
        await workspace.updateRecord(record.id, { doc })
      } catch (reason) { error = reason instanceof Error ? reason.message : 'Could not update this item.' }
    }
  }
</script>

{#if items.length === 0}
  <p class="text-[12.5px] text-muted-foreground/50">No checklist items</p>
{:else}
  <div class="space-y-2">
    {#if showProgress}
      <div class="flex items-center gap-2">
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <div class="h-full rounded-full bg-primary transition-all" style="width:{percent}%"></div>
        </div>
        <span class="text-[11px] tabular-nums text-muted-foreground">{done}/{items.length}</span>
      </div>
    {/if}
    <ul class="space-y-1">
      {#each items as item (item.id)}
        <li>
          <button
            type="button"
            disabled={!canEdit}
            class={cn(
              'flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[13.5px] transition-colors',
              canEdit && 'hover:bg-accent/60',
              !canEdit && 'cursor-default'
            )}
            onclick={() => toggle(item)}
          >
            <Icon
              name={item.done ? 'checkbox-fill' : 'checkbox-line'}
              size={15}
              class={cn('mt-0.5 shrink-0', item.done ? 'text-success' : 'text-muted-foreground')}
            />
            <span class={item.done ? 'text-muted-foreground line-through' : ''}>{item.text}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
{#if error}<p class="mt-1 text-[11px] text-destructive" role="alert">{error}</p>{/if}
