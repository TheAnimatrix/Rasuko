<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import type { RichDoc } from '@shared/richtext'
  import { emptyDoc } from '@shared/richtext'
  import { newId } from '@shared/ids'
  import { prop } from '../props'
  import { partialDocFor } from '@shared/viewOps'
  import { saveBoundRichDoc, type BoundRichTarget } from '../saveBoundRichDoc'
  import RichText from '../RichText.svelte'
  import RichEditor from '$lib/editor/RichEditor.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { ICONS } from '$lib/icon-names'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { settingsStore } from '$lib/stores/settings.svelte'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const placeholder = $derived(String(prop(node, 'placeholder', 'Start writing…') ?? ''))
  const record = $derived(node.bind ? records[node.bind.recordId] : undefined)
  const isRich = $derived(record?.kind === 'richtext')

  /**
   * A barebones page is meant to feel like a blank sheet: no toolbar, no block
   * gutters. Formatting is still available through the selection bubble and the
   * slash menu, so nothing is lost — it simply stops shouting.
   */
  const barebones = $derived(workspace.payload?.view.kind === 'barebones')
  const canEdit = $derived(editable && Boolean(prop(node, 'editable', true)))

  /**
   * A page-level binding gets the full editor. A block-scoped binding uses the
   * same editor in compact form and merges its projection back by stable ID.
   */
  const blockScoped = $derived(Boolean(node.bind?.blockIds && node.bind.blockIds.length > 0))
  const doc = $derived<RichDoc>(
    isRich ? (partialDocFor(record, node.bind!) ?? emptyDoc()) : emptyDoc()
  )
  /**
   * The page flag wins; the global setting is only a fallback for older pages.
   */
  const markdown = $derived(
    workspace.payload?.page.markdown ?? (settingsStore.value?.editor.markdown ?? false)
  )
  const projectId = $derived(workspace.payload?.page.projectId)
  const viewId = $derived(workspace.payload?.view.id)

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

  async function startWriting() {
    const payload = workspace.payload
    if (!canEdit || !payload || node.bind) return
    const origin = {
      projectId: payload.page.projectId,
      pageId: payload.page.id,
      viewId: payload.view.id,
      nodeId: node.id
    }
    const created = await workspace.createRecord({
      id: newId('record'),
      kind: 'richtext',
      label: payload.page.title || 'Notes',
      doc: emptyDoc(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { projectId: origin.projectId, pageId: origin.pageId })
    if (!created) return
    await window.rasuko.view.applyOps(
      origin.projectId,
      origin.viewId,
      [{ op: 'setBind', target: origin.nodeId, bind: { recordId: created.id } }],
      'Bound a new writing surface'
    )
    if (workspace.payload?.page.id === origin.pageId) await workspace.refreshPayload(origin.pageId)
  }
</script>

{#if isRich && record}
  {#if canEdit}
    <RichEditor
      {doc}
      recordId={record.id}
      {projectId}
      {viewId}
      nodeId={node.id}
      blockIds={node.bind?.blockIds ?? []}
      {markdown}
      editable
      {placeholder}
      toolbar={!blockScoped && Boolean(prop(node, 'showToolbar', true))}
      subtle={barebones}
      showHandles={!blockScoped}
      compact={blockScoped}
      ondocchange={saveDoc}
    />
  {:else}
    <RichText {doc} />
  {/if}
{:else if canEdit}
  <div
    class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-4 py-6"
  >
    <div class="flex items-center gap-2 text-muted-foreground">
      <Icon name={ICONS.document} size={16} />
      <span class="text-[12.5px]">{placeholder || 'This section has no content yet.'}</span>
    </div>
    <Button variant="outline" size="sm" onclick={startWriting}>
      <Icon name={ICONS.editPen} size={14} />
      Start writing
    </Button>
  </div>
{:else}
  <p class="text-[13px] text-muted-foreground">{placeholder || 'No content'}</p>
{/if}
