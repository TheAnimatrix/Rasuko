<script lang="ts">
/**
 * Unplaced content.
 *
 * When a redesign drops a binding, the record is never deleted — it is marked
 * orphaned. This surfaces it with one-click recovery: reattach to a compatible
 * node, fold its text into the writing surface, or keep it as a quiet note.
 */

import type { ContentRecord, ViewNode } from '@shared/types'
import { newId } from '@shared/ids'
import { walk } from '@shared/viewOps'
import { workspace } from '$lib/stores/workspace.svelte'
import Button from '$lib/components/ui/Button.svelte'
import Dialog from '$lib/components/ui/Dialog.svelte'
import Badge from '$lib/components/ui/Badge.svelte'
import Icon from '$lib/components/Icon.svelte'
import { kindIcon, recordLabel, recordPlainText } from './props'

interface Props {
  orphaned: ContentRecord[]
}

let { orphaned }: Props = $props()

/** Node types that can host each record kind. */
const COMPATIBLE: Record<string, string[]> = {
  richtext: ['rich'],
  table: [
    'table',
    'kanban',
    'timeline',
    'calendar',
    'gallery',
    'list',
    'progress',
    'chart.bar',
    'chart.line',
    'chart.donut'
  ],
  fields: ['fields', 'keyvalue'],
  metric: ['metric', 'progress', 'chart.bar', 'chart.line', 'chart.donut'],
  list: ['list', 'checklist', 'gallery', 'progress']
}

let pickerRecord = $state<ContentRecord | null>(null)
let pickerOpen = $state(false)
let kept = $state<Set<string>>(new Set())

const view = $derived(workspace.payload?.view ?? null)

const allNodes = $derived.by<ViewNode[]>(() => {
  if (!view) return []
  const out: ViewNode[] = []
  walk(view.root, (node) => out.push(node))
  return out
})

function compatible(node: ViewNode, record: ContentRecord): boolean {
  return (COMPATIBLE[record.kind] ?? []).includes(node.type)
}

function compatibleNodes(record: ContentRecord): ViewNode[] {
  return allNodes.filter((node) => compatible(node, record))
}

function suggest(record: ContentRecord): ViewNode | null {
  return compatibleNodes(record).find((node) => !node.bind) ?? null
}

function reattach(record: ContentRecord): void {
  const target = suggest(record)
  if (target) {
    void workspace.reattach(record.id, target.id)
    return
  }
  pickerRecord = record
  pickerOpen = true
}

function choose(node: ViewNode): void {
  if (!pickerRecord) return
  void workspace.reattach(pickerRecord.id, node.id)
  pickerRecord = null
  pickerOpen = false
}

function convert(record: ContentRecord): void {
  const records = workspace.payload?.records ?? {}
  const rich = Object.values(records).find((candidate) => candidate.kind === 'richtext')
  if (!rich || rich.kind !== 'richtext') return
  const text = recordPlainText(record)
  const block = { id: newId('block'), type: 'paragraph' as const, runs: text ? [{ text }] : [] }
  void workspace.updateRecord(rich.id, {
    doc: { type: 'doc', blocks: [...rich.doc.blocks, block] }
  })
  kept = new Set([...kept, record.id])
}

function keep(record: ContentRecord): void {
  kept = new Set([...kept, record.id])
}

const pickerOptions = $derived(pickerRecord ? compatibleNodes(pickerRecord) : [])
</script>

{#if orphaned.length > 0}
  <div class="rounded-xl border border-border bg-card p-3.5">
    <div class="flex items-center gap-2">
      <span class="flex size-6 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon name="inbox-line" size={14} />
      </span>
      <h3 class="text-[13px] font-medium">Unplaced content</h3>
      <span class="text-[11px] tabular-nums text-muted-foreground">{orphaned.length}</span>
    </div>
    <p class="mt-1.5 text-[12px] text-muted-foreground text-pretty">
      A redesign left this content unbound. It was kept — reattach it, fold it into a text block,
      or keep it as a note.
    </p>

    <div class="mt-3 space-y-2">
      {#each orphaned as record (record.id)}
        {#if kept.has(record.id)}
          <div class="flex items-center gap-2 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground">
            <Icon name="bookmark-line" size={12} />
            <span class="truncate">Kept as note · {recordLabel(record)}</span>
          </div>
        {:else}
          <div class="rounded-lg border border-border px-2.5 py-2">
            <div class="flex items-center gap-2">
              <Icon name={kindIcon(record.kind)} size={14} class="shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-[13px]">{recordLabel(record)}</span>
              <Badge tone="neutral">{record.kind}</Badge>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onclick={() => reattach(record)}>Reattach</Button>
              <Button size="sm" variant="ghost" onclick={() => convert(record)}>
                Convert to a text block
              </Button>
              <Button size="sm" variant="ghost" onclick={() => keep(record)}>Keep as note</Button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<Dialog
  bind:open={pickerOpen}
  title="Reattach content"
  description="Choose a compatible node in this View to bind the record to."
>
  <div class="max-h-80 space-y-0.5 overflow-y-auto scrollbar-thin">
    {#each pickerOptions as node (node.id)}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        onclick={() => choose(node)}
      >
        <Icon name={node.bind ? 'link-line' : 'plus-line'} size={14} class="text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-[13px]">{node.type}</span>
        <span class="font-mono text-[10.5px] text-muted-foreground">{node.id.slice(0, 12)}…</span>
      </button>
    {:else}
      <p class="px-2 py-6 text-center text-[12.5px] text-muted-foreground">
        No compatible node in this View.
      </p>
    {/each}
  </div>
</Dialog>
