<script lang="ts">
/**
 * The chrome around every View node.
 *
 * Adds the grid span, and — when the View is editable — a hover control cluster
 * with the contextual node menu. Reassigning or detaching content is expressed
 * as view ops, so it flows through the same validated path as the assistant.
 *
 * A binding that points at a record which no longer exists renders an inline
 * "pick a replacement" strip instead of failing silently.
 */

import type { Snippet } from 'svelte'
import type { ContentRecord, ViewNode } from '@shared/types'
import { cn } from '$lib/utils'
import { workspace } from '$lib/stores/workspace.svelte'
import { chat } from '$lib/stores/chat.svelte'
import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte'
import Dialog from '$lib/components/ui/Dialog.svelte'
import Button from '$lib/components/ui/Button.svelte'
import Icon from '$lib/components/Icon.svelte'
import { ICONS } from '$lib/icon-names'
import { kindIcon, recordLabel, spanClass } from './props'

interface Props {
  node: ViewNode
  records?: Record<string, ContentRecord>
  editable?: boolean
  onrequestRedesign?: (nodeId: string) => void
  children: Snippet
}

let { node, records = {}, editable = true, onrequestRedesign, children }: Props = $props()

let reassignOpen = $state(false)

const dangling = $derived(Boolean(node.bind && !records[node.bind.recordId]))
const allRecords = $derived(Object.values(records))

const menuItems = $derived([
  { id: 'ask', label: 'Ask assistant about this', icon: ICONS.chat },
  { id: 'reassign', label: 'Reassign content…', icon: ICONS.attach },
  ...(node.bind
    ? [{ id: 'detach', label: 'Detach content', icon: 'link-line' as string }]
    : []),
  { id: 'redesign', label: 'Redesign this section…', icon: ICONS.magic, separatorBefore: true },
  { id: 'copy', label: 'Copy node id', icon: ICONS.copy }
])

function onselect(id: string): void {
  switch (id) {
    case 'ask':
      void chat.send(`About node ${node.id} (${node.type}): `)
      break
    case 'reassign':
      reassignOpen = true
      break
    case 'detach':
      void workspace.applyOps(
        [{ op: 'setBind', target: node.id, bind: null }],
        'Detached content'
      )
      break
    case 'redesign':
      onrequestRedesign?.(node.id)
      break
    case 'copy':
      void navigator.clipboard?.writeText(node.id)
      break
    default:
      break
  }
}

function reassign(recordId: string): void {
  reassignOpen = false
  void workspace.applyOps(
    [{ op: 'setBind', target: node.id, bind: { recordId } }],
    'Reassigned content'
  )
}
</script>

{#snippet trigger()}
  <button
    type="button"
    title="Node actions"
    aria-label="Node actions"
    class="inline-flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
  >
    <Icon name={ICONS.more} size={14} />
  </button>
{/snippet}

<div class={cn('group/node relative min-w-0', spanClass(node.span))}>
  {#if editable}
    <div
      class="absolute -top-2.5 right-1 z-20 opacity-0 transition-opacity focus-within:opacity-100 group-hover/node:opacity-100"
    >
      <DropdownMenu items={menuItems} onselect={onselect} {trigger} align="end" />
    </div>
  {/if}

  {#if dangling}
    <div
      class="mb-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[12px] text-warning"
    >
      <Icon name="alert-line" size={14} />
      <span class="flex-1">Content missing — pick a replacement</span>
      <Button variant="outline" size="sm" onclick={() => (reassignOpen = true)}>Replace</Button>
    </div>
  {/if}

  {@render children()}
</div>

<Dialog
  bind:open={reassignOpen}
  title="Reassign content"
  description="Bind this component to a content record on this page."
>
  <div class="max-h-80 space-y-0.5 overflow-y-auto scrollbar-thin">
    {#each allRecords as record (record.id)}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        onclick={() => reassign(record.id)}
      >
        <Icon name={kindIcon(record.kind)} size={14} class="text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-[13px]">{recordLabel(record)}</span>
        {#if node.bind?.recordId === record.id}
          <Icon name="check-line" size={13} class="text-accent-foreground" />
        {/if}
        <span class="text-[11px] text-muted-foreground">{record.kind}</span>
      </button>
    {:else}
      <p class="px-2 py-6 text-center text-[12.5px] text-muted-foreground">
        No content records on this page yet.
      </p>
    {/each}
  </div>
</Dialog>
