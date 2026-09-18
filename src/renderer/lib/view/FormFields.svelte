<script lang="ts">
/**
 * Purpose-built data-entry form for a `fields` record.
 *
 * The schema (`fields`) and saved rows (`entries`) live on the record, so a form
 * keeps its shape across any View redesign. Submitting appends an entry — it is
 * never a destructive edit.
 */

import { onDestroy, untrack } from 'svelte'
import type { FieldsRecord, TableCellValue } from '@shared/types'
import { newId } from '@shared/ids'
import { cn } from '$lib/utils'
import Icon from '$lib/components/Icon.svelte'
import Button from '$lib/components/ui/Button.svelte'
import TypedField from './TypedField.svelte'
import { ICONS } from '$lib/icon-names'
import { formatDate } from '$lib/utils'
import { flushEditors } from '$lib/flushEditors'
import { clearFormDraft, loadFormDraft, saveFormDraft, type FormDraftScope } from '$lib/viewState'
import { runQueuedRecordAction } from './recordActionQueue'
import { workspace } from '$lib/stores/workspace.svelte'

interface Props {
  record: FieldsRecord
  editable?: boolean
  layout?: 'stack' | 'inline'
  submitLabel?: string
  /** Optional binding.field projection for a single purpose-built input. */
  fieldId?: string
  mode?: 'value' | 'editor' | 'list'
}

let { record, editable = true, layout = 'stack', submitLabel = '', fieldId, mode }: Props = $props()

const fields = $derived(
  fieldId ? (record.fields ?? []).filter((field) => field.id === fieldId || field.name === fieldId) : (record.fields ?? [])
)
const entries = $derived(record.entries ?? [])
const direct = $derived(Boolean(fieldId) && mode !== 'list')

function draftScope(): FormDraftScope | null {
  const payload = workspace.payload
  if (!payload || direct) return null
  return {
    projectId: payload.page.projectId,
    viewId: payload.view.id,
    recordId: record.id,
    projection: `${fieldId ?? '*'}:${mode ?? 'form'}`
  }
}

function scopeIdentity(scope: FormDraftScope | null): string {
  return scope ? `${scope.projectId}\u0000${scope.viewId}\u0000${scope.recordId}\u0000${scope.projection ?? '*'}` : ''
}

const initialDraft = untrack(() => {
  const scope = draftScope()
  return scope ? loadFormDraft(scope, fields) : null
})

let values = $state<Record<string, TableCellValue>>(
  untrack(() => $state.snapshot(initialDraft ?? record.values ?? {}))
)
let currentId = untrack(() => record.id)
let currentProjectId = untrack(() => workspace.payload?.page.projectId)
let currentDraftIdentity = untrack(() => scopeIdentity(draftScope()))
let dirty = $state(initialDraft !== null)
let pendingCount = $state(0)
let formError = $state('')
let submitting = $state(false)
let draftSaved = $state(initialDraft !== null)
let draftSaveFailed = $state(false)
const pendingWrites = new Set<Promise<void>>()

function serialize(value: Record<string, TableCellValue>): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

$effect(() => {
  const projectId = workspace.payload?.page.projectId
  const incoming = record.values ?? {}
  const scope = draftScope()
  const identity = scopeIdentity(scope)
  if (record.id !== currentId || projectId !== currentProjectId || identity !== currentDraftIdentity) {
    currentId = record.id
    currentProjectId = projectId
    currentDraftIdentity = identity
    const restored = scope ? loadFormDraft(scope, fields) : null
    values = $state.snapshot(restored ?? incoming)
    dirty = restored !== null
    draftSaved = restored !== null
    draftSaveFailed = false
    return
  }
  if (!dirty && pendingCount === 0 && serialize(incoming) !== serialize(values)) {
    values = $state.snapshot(incoming)
  }
})

function track(write: Promise<void>): Promise<void> {
  pendingWrites.add(write)
  pendingCount += 1
  const finish = () => {
    pendingWrites.delete(write)
    pendingCount -= 1
  }
  void write.then(finish, finish)
  return write
}

function pending(): Promise<void> | undefined {
  if (pendingWrites.size === 0) return undefined
  return Promise.all([...pendingWrites]).then(() => undefined)
}

$effect(() => {
  const handler = (event: Event): void => {
    // Draft entry forms stay drafts. Only already-started direct edits or an
    // intentional Submit participate in the editor flush barrier.
    const writes = pending()
    const detail = (event as CustomEvent<{ waitUntil?: (promise: Promise<unknown>) => void }>).detail
    if (writes && detail?.waitUntil) detail.waitUntil(writes)
  }
  window.addEventListener('rasuko:flush-editors', handler)
  return () => window.removeEventListener('rasuko:flush-editors', handler)
})

onDestroy(() => {
  const writes = pending()
  if (writes) void writes.catch(() => undefined)
})

function setDraft(fieldId: string, value: TableCellValue): void {
  values = { ...values, [fieldId]: value }
  if (!direct) {
    dirty = true
    const scope = draftScope()
    draftSaved = scope ? saveFormDraft(scope, fields, $state.snapshot(values)) : false
    draftSaveFailed = Boolean(scope && !draftSaved)
  }
}

async function setValue(fieldId: string, value: TableCellValue): Promise<void> {
  setDraft(fieldId, value)
  if (direct && editable) {
    dirty = false
    const projectId = workspace.payload?.page.projectId
    const recordId = record.id
    if (projectId) await runQueuedRecordAction(recordId, { type: 'fields.update', values: { [fieldId]: value } }, projectId)
  }
}

const missingRequired = $derived(
  fields.length === 0 || fields.some((field) => {
    if (!field.required) return false
    const value = values[field.id]
    return value === null || value === undefined || value === '' || value === false
  })
)

async function submit(): Promise<void> {
  if (!editable || submitting) return
  submitting = true
  formError = ''
  try {
    await flushEditors()
    if (missingRequired) return
    const projectId = workspace.payload?.page.projectId
    const recordId = record.id
    const scope = draftScope()
    if (!projectId) return
    const submittedValues = { ...$state.snapshot(values) }

    if (!fieldId) {
      const receipt = await runQueuedRecordAction(recordId, { type: 'fields.submit', values: submittedValues, clear: true }, projectId)
      if (scope) clearFormDraft(scope)
      if (receipt.record.kind === 'fields' && record.id === recordId && workspace.payload?.page.projectId === projectId) {
        values = $state.snapshot(receipt.record.values)
        dirty = false
        draftSaved = false
        draftSaveFailed = false
      }
      return
    }

    // A projected form submits only its visible fields and preserves the rest.
    const submittedFieldIds = fields.map((field) => field.id)
    const write = (async () => {
      const latest = await window.rasuko.records.get(projectId, recordId)
      if (!latest || latest.kind !== 'fields') return
      const entry = { id: newId('block'), values: submittedValues, createdAt: new Date().toISOString() }
      const remaining = { ...latest.values }
      for (const id of submittedFieldIds) delete remaining[id]
      await workspace.updateRecord(recordId, { entries: [...(latest.entries ?? []), entry], values: remaining }, projectId)
      if (scope) clearFormDraft(scope)
      if (record.id === recordId && workspace.payload?.page.projectId === projectId) {
        values = remaining
        dirty = false
        draftSaved = false
        draftSaveFailed = false
      }
    })()
    await track(write)
  } finally {
    submitting = false
  }
}

function submitSafely(): void {
  void submit().catch((reason) => {
    formError = reason instanceof Error ? reason.message : 'Could not submit this form.'
  })
}

function discardDraft(): void {
  const scope = draftScope()
  if (scope) clearFormDraft(scope)
  values = $state.snapshot(record.values ?? {})
  dirty = false
  draftSaved = false
  draftSaveFailed = false
  formError = ''
}

function stringValue(value: TableCellValue): string {
  return value === null || value === undefined ? '' : String(value)
}

const gridClass = $derived(layout === 'inline' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')
</script>

<form
  class="space-y-3"
  onsubmit={(event) => {
    event.preventDefault()
    submitSafely()
  }}
>
  <div class={cn('grid gap-3', gridClass)}>
    {#each fields as field (field.id)}
      {@const value = values[field.id]}
      <label class="block space-y-1" for={`${record.id}-${field.id}`}>
        <span class="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground">
          {field.name}
          {#if field.required}<span class="text-destructive">*</span>{/if}
        </span>

        <TypedField column={field} {value} {editable} ondraft={(next) => setDraft(field.id, next)} onchange={(next) => setValue(field.id, next)} />
      </label>
    {/each}
  </div>

  {#if editable && !direct}
    <div class="flex items-center gap-2">
      <Button type="submit" size="sm" disabled={missingRequired || submitting}>
        <Icon name={ICONS.check} size={13} />
        {submitLabel || 'Submit'}
      </Button>
      {#if dirty}<Button type="button" size="sm" variant="ghost" onclick={discardDraft}>Discard draft</Button>{/if}
      {#if missingRequired}
        <span class="text-[11.5px] text-muted-foreground">
          {fields.length === 0 ? 'This bound field is unavailable' : 'Fill the required fields'}
        </span>
      {/if}
    </div>
  {/if}
  {#if !direct && draftSaved}<p class="text-[11px] text-muted-foreground">Draft saved locally</p>{/if}
  {#if !direct && draftSaveFailed}<p class="text-[11px] text-warning" role="status">Draft could not be saved locally</p>{/if}
  {#if formError}<p class="text-[12px] text-destructive" role="alert">{formError}</p>{/if}
</form>

{#if entries.length > 0}
  <div class="mt-4 space-y-1.5">
    <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      Saved entries · {entries.length}
    </p>
    <div class="space-y-1.5">
      {#each entries as entry (entry.id)}
        <div class="rounded-lg border border-border bg-card px-2.5 py-2 text-[12.5px]">
          <div class="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Icon name="time-line" size={12} />
            {formatDate(entry.createdAt)}
          </div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {#each fields as field (field.id)}
              <dt class="truncate text-muted-foreground">{field.name}</dt>
              <dd class="truncate">
                {stringValue(entry.values[field.id]) || '—'}
              </dd>
            {/each}
          </dl>
        </div>
      {/each}
    </div>
  </div>
{/if}
