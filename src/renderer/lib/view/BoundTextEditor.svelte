<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import type { RichDoc } from '@shared/richtext'
  import { emptyDoc } from '@shared/richtext'
  import { newId } from '@shared/ids'
  import { partialDocFor } from '@shared/viewOps'
  import { saveBoundRichDoc, type BoundRichTarget } from './saveBoundRichDoc'
  import RichEditor from '$lib/editor/RichEditor.svelte'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { settingsStore } from '$lib/stores/settings.svelte'
  import { cn } from '$lib/utils'
  import RichText from './RichText.svelte'
  import { prop } from './props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
    placeholder?: string
    class?: string
    blockClass?: string
    level?: number
    blockType?: 'paragraph' | 'heading' | 'quote' | 'code'
  }

  let {
    node,
    records,
    editable = true,
    placeholder = '',
    class: className,
    blockClass,
    level,
    blockType = level ? 'heading' : 'paragraph'
  }: Props = $props()

  const record = $derived(node.bind ? records[node.bind.recordId] : undefined)
  const rich = $derived(record?.kind === 'richtext' ? record : null)
  // A text-like View node is always a block projection. Legacy Views omitted
  // blockIds, so resolve them to the first stable block instead of treating the
  // component as an unsafe whole-document editor.
  const resolvedBlockIds = $derived(
    node.bind?.blockIds?.length ? node.bind.blockIds : rich?.doc.blocks[0]?.id ? [rich.doc.blocks[0].id] : []
  )
  const doc = $derived<RichDoc>(rich && node.bind
    ? (partialDocFor(rich, { ...node.bind, blockIds: resolvedBlockIds }) ?? emptyDoc())
    : emptyDoc())
  const nodeEditable = $derived(editable && Boolean(prop(node, 'editable', true)))
  const canEdit = $derived(nodeEditable && Boolean(rich))
  const projectId = $derived(workspace.payload?.page.projectId)
  const viewId = $derived(workspace.payload?.view.id)
  const markdown = $derived(
    workspace.payload?.page.markdown ?? (settingsStore.value?.editor.markdown ?? false)
  )

  async function saveDoc(
    next: RichDoc,
    target: {
      recordId: string
      projectId?: string
      blockIds: readonly string[]
      viewId?: string
      nodeId?: string
    }
  ): Promise<void> {
    if (!target.projectId) return
    await saveBoundRichDoc(target as BoundRichTarget, next)
    if (workspace.payload?.page.projectId === target.projectId) await workspace.refreshPayload()
  }

  async function startWriting(): Promise<void> {
    const payload = workspace.payload
    if (!nodeEditable || !payload || node.bind) return
    const origin = {
      projectId: payload.page.projectId,
      pageId: payload.page.id,
      viewId: payload.view.id,
      nodeId: node.id
    }
    const blockId = newId('block')
    const created = await workspace.createRecord({
      id: newId('record'),
      kind: 'richtext',
      label: payload.page.title || 'Text',
      doc: {
        type: 'doc',
        blocks: blockType === 'heading'
          ? [{ id: blockId, type: 'heading', level: Math.min(3, Math.max(1, level ?? 1)) as 1 | 2 | 3, runs: [] }]
          : blockType === 'quote'
            ? [{ id: blockId, type: 'quote', runs: [] }]
            : blockType === 'code'
              ? [{ id: blockId, type: 'code', text: '' }]
              : [{ id: blockId, type: 'paragraph', runs: [] }]
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { projectId: origin.projectId, pageId: origin.pageId })
    if (!created) return
    await window.rasuko.view.applyOps(origin.projectId, origin.viewId, [
      { op: 'setBind', target: origin.nodeId, bind: { recordId: created.id, blockIds: [blockId] } }
    ], 'Bound a new text field')
    if (workspace.payload?.page.id === origin.pageId) await workspace.refreshPayload(origin.pageId)
  }
</script>

{#if canEdit && rich}
  <RichEditor
    {doc}
    recordId={rich.id}
    {projectId}
    {viewId}
    nodeId={node.id}
    blockIds={resolvedBlockIds}
    {markdown}
    editable
    {placeholder}
    toolbar={false}
    showHandles={false}
    compact
    class={className}
    {blockClass}
    ondocchange={saveDoc}
  />
{:else if nodeEditable && !node.bind}
  <button
    type="button"
    class={cn('block w-full text-left text-muted-foreground/45', className)}
    onclick={() => void startWriting()}
    aria-label={`Start editing ${placeholder || 'text'}`}
  >
    <span class={blockClass}>{placeholder}</span>
  </button>
{:else}
  <RichText {doc} {placeholder} class={className} {level} />
{/if}
