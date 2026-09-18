<script lang="ts">
  import type { ContentRecord, TableCellValue, ViewDoc, ViewNode } from '@shared/types'
  import { getComponent, type PropSpec } from '@shared/viewSchema'
  import { inspectView } from '@shared/viewCapabilities'
  import { workspace } from '$lib/stores/workspace.svelte'
  import TypedField from '$lib/view/TypedField.svelte'
  import { trackUiWrite } from '$lib/pendingUiWrites'
  import { blockPlainText } from '@shared/richtext'

  let { view, records }: { view: ViewDoc; records: Record<string, ContentRecord> } = $props()
  const nodes = $derived.by(() => {
    const result: ViewNode[] = []
    const visit = (node: ViewNode) => { result.push(node); node.children?.forEach(visit) }
    visit(view.root)
    return result
  })
  const inspection = $derived(inspectView(view, records))
  let error = $state('')
  async function setProp(nodeId: string, name: string, value: unknown): Promise<void> {
    error = ''
    try { await workspace.applyOps([{ op: 'setProps', target: nodeId, props: { [name]: value } }]) }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not save this setting'; throw reason }
  }
  async function bind(node: ViewNode, recordId: string, blockId?: string): Promise<void> {
    error = ''
    try {
      const record = records[recordId]
      const blockBinding = getComponent(node.type)?.bindable === 'block'
      const selected = blockId ?? (record?.kind === 'richtext' ? record.doc.blocks[0]?.id : undefined)
      if (recordId && blockBinding && !selected) throw new Error('This text record is empty. Add text before assigning a block')
      await trackUiWrite(workspace.applyOps([{ op: 'setBind', target: node.id, bind: recordId ? { recordId, ...(blockBinding ? { blockIds: [selected!] } : {}) } : null }]))
    }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Could not bind this component' }
  }
  function controlType(spec: PropSpec): 'number' | 'checkbox' | 'select' | 'text' {
    return spec.kind === 'number' ? 'number' : spec.kind === 'boolean' ? 'checkbox' : spec.kind === 'enum' ? 'select' : 'text'
  }
  async function renameField(record: ContentRecord, fieldId: string, value: TableCellValue): Promise<void> {
    const projectId = workspace.payload?.page.projectId
    if (!projectId || typeof value !== 'string' || !value.trim()) return
    error = ''
    try {
      const latest = await window.rasuko.records.get(projectId, record.id)
      if (!latest) throw new Error('Content no longer exists')
      await window.rasuko.records.renameField(projectId, record.id, fieldId, value.trim(), latest.revision ?? 0)
      await workspace.refreshPayload()
    } catch (reason) { error = reason instanceof Error ? reason.message : 'Could not rename this field'; throw reason }
  }
</script>

<div class="max-h-[65vh] space-y-4 overflow-y-auto pr-1 scrollbar-thin">
  <p class="text-[12px] text-muted-foreground">Adjust the components in this View. Content keeps its identity when labels or presentation change.</p>
  {#if error}<p role="alert" class="text-[12px] text-destructive">{error}</p>{/if}
  {#if !inspection.valid}<p class="text-[12px] text-destructive">Some bindings need attention. Reassign their content below.</p>{/if}
  {#each nodes as node (node.id)}
    {@const spec = getComponent(node.type)}
    {@const boundRecord = node.bind && records[node.bind.recordId]}
    {#if spec}
      <details class="rounded-lg border border-border px-3 py-2">
        <summary class="cursor-pointer text-[13px] font-medium">{spec.label}{node.bind && records[node.bind.recordId]?.label ? ` · ${records[node.bind.recordId].label}` : ''}</summary>
        <div class="mt-3 space-y-3">
          {#if spec.bindable !== false}
            <label class="block space-y-1 text-[12px]">
              <span class="text-muted-foreground">Content</span>
              <select class="w-full rounded border border-input bg-background px-2 py-1.5" value={node.bind?.recordId ?? ''} onchange={(event) => void bind(node, event.currentTarget.value)}>
                <option value="">No content assigned</option>
                {#each Object.values(records).filter((record) => spec.bindable === 'block' ? record.kind === 'richtext' : Array.isArray(spec.bindable) && spec.bindable.includes(record.kind)) as record (record.id)}
                  <option value={record.id}>{record.label || record.kind}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if spec.bindable === 'block' && boundRecord && boundRecord.kind === 'richtext'}
            <label class="block space-y-1 text-[12px]">
              <span class="text-muted-foreground">Text block</span>
              <select class="w-full rounded border border-input bg-background px-2 py-1.5" value={node.bind?.blockIds?.[0] ?? boundRecord.doc.blocks[0]?.id ?? ''} onchange={(event) => void bind(node, boundRecord.id, event.currentTarget.value)}>
                {#each boundRecord.doc.blocks as block (block.id)}<option value={block.id}>{blockPlainText(block).slice(0, 80) || 'Empty block'}</option>{/each}
              </select>
            </label>
          {/if}
          <div class="grid gap-2 sm:grid-cols-2">
            {#each Object.entries(spec.props).filter(([, prop]) => !['node', 'stringList'].includes(prop.kind)) as [name, prop] (name)}
              <label class="space-y-1 text-[12px]">
                <span class="text-muted-foreground">{prop.label}</span>
                <TypedField column={{ id: name, name: prop.label, type: controlType(prop), options: prop.values ? [...prop.values] : undefined }} value={(node.props?.[name] ?? prop.default ?? null) as TableCellValue} onchange={(value) => setProp(node.id, name, value)} />
              </label>
            {/each}
          </div>
          <p class="text-[11px] text-muted-foreground">{spec.summary}</p>
        </div>
      </details>
    {/if}
  {/each}
  {#each Object.values(records).filter((record) => record.kind === 'table' || record.kind === 'fields') as record (record.id)}
    <details class="rounded-lg border border-border px-3 py-2">
      <summary class="cursor-pointer text-[13px] font-medium">Fields · {record.label || record.kind}</summary>
      <div class="mt-3 space-y-2">
        {#each record.kind === 'table' ? record.columns : record.kind === 'fields' ? record.fields : [] as field (field.id)}
          <div class="flex items-center gap-2"><TypedField column={{ id: field.id, name: 'Field label', type: 'text' }} value={field.name} onchange={(value) => renameField(record, field.id, value)} /><span class="text-[11px] text-muted-foreground">{field.type}</span></div>
        {/each}
      </div>
    </details>
  {/each}
</div>
