<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { FieldDef, TableCellValue, TableColumn } from '@shared/types'
  import { cn } from '$lib/utils'

  interface Props {
    column: TableColumn | FieldDef
    value: TableCellValue
    editable?: boolean
    compact?: boolean
    class?: string
    ondraft?: (value: TableCellValue) => void
    onchange?: (value: TableCellValue) => void | Promise<void>
  }

  let { column, value, editable = true, compact = false, class: className, ondraft, onchange }: Props = $props()
  function raw(source: TableCellValue): string | boolean { return column.type === 'checkbox' ? Boolean(source) : source == null ? '' : String(source) }
  let draft = $state<string | boolean>(untrack(() => raw(value)))
  let dirty = $state(false), focused = $state(false), error = $state('')
  let pending: Promise<void> | null = null

  const inputClass = $derived(cn('w-full rounded border bg-transparent outline-none transition-colors disabled:cursor-default', error ? 'border-destructive' : 'border-transparent hover:border-border focus:border-ring', compact ? 'px-1 py-0.5 text-[12px]' : 'px-2 py-1.5 text-[13px]', className))

  $effect(() => {
    const incoming = value
    if (!dirty && !focused && !pending) draft = raw(incoming)
  })

  function edit(next: string | boolean): void {
    draft = next; dirty = true; error = ''
    try {
      if (column.type === 'checkbox') ondraft?.(Boolean(next))
      else if (column.type === 'number') {
        const text = String(next), number = Number(text)
        if (text === '') ondraft?.(null)
        else if (Number.isFinite(number)) ondraft?.(number)
      } else ondraft?.(String(next))
    } catch (reason) { error = reason instanceof Error ? reason.message : 'Invalid value' }
  }
  function parsed(): TableCellValue {
    if (column.type === 'checkbox') return Boolean(draft)
    const text = String(draft)
    if (column.type === 'number') {
      if (text === '') return null
      const number = Number(text)
      if (!Number.isFinite(number)) throw new Error(`${column.name} requires a number`)
      return number
    }
    return text
  }
  function commit(): Promise<void> | undefined {
    if (!dirty) return pending ?? undefined
    let next: TableCellValue
    try { next = parsed() } catch (reason) { error = reason instanceof Error ? reason.message : 'Invalid value'; return Promise.reject(reason) }
    dirty = false
    const operation = Promise.resolve().then(() => onchange?.(next)).then(() => { error = '' }, (reason) => { dirty = true; error = reason instanceof Error ? reason.message : 'Could not save this field.'; throw reason })
    pending = operation
    void operation.then(() => { if (pending === operation) pending = null }, () => { if (pending === operation) pending = null })
    return operation
  }
  function safelyCommit(): void { const saving = commit(); if (saving) void saving.catch(() => undefined) }

  $effect(() => {
    const handler = (event: Event): void => {
      const saving = commit()
      if (saving) (event as CustomEvent<{ waitUntil?: (promise: Promise<unknown>) => void }>).detail?.waitUntil?.(saving)
    }
    window.addEventListener('rasuko:flush-editors', handler)
    return () => window.removeEventListener('rasuko:flush-editors', handler)
  })
  onDestroy(safelyCommit)
</script>

{#if column.type === 'checkbox'}
  <input type="checkbox" class="size-4 accent-[var(--color-primary)]" checked={Boolean(draft)} disabled={!editable} aria-label={column.name} onchange={(event) => { edit(event.currentTarget.checked); safelyCommit() }} />
{:else if column.type === 'select'}
  <select class={cn(inputClass, 'cursor-pointer')} value={String(draft)} disabled={!editable} aria-label={column.name} onfocus={() => focused = true} onblur={() => { focused = false; safelyCommit() }} onchange={(event) => { edit(event.currentTarget.value); safelyCommit() }}>
    <option value="">—</option>{#each column.options ?? [] as option (option)}<option value={option}>{option}</option>{/each}
  </select>
{:else if column.type === 'longtext'}
  <textarea rows={3} class={inputClass} value={String(draft)} disabled={!editable} aria-label={column.name} onfocus={() => focused = true} oninput={(event) => edit(event.currentTarget.value)} onblur={() => { focused = false; safelyCommit() }}></textarea>
{:else}
  <input type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : column.type === 'url' ? 'url' : 'text'} class={inputClass} value={String(draft)} disabled={!editable} aria-label={column.name} onfocus={() => focused = true} oninput={(event) => edit(event.currentTarget.value)} onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()} onblur={() => { focused = false; safelyCommit() }} />
{/if}
{#if error}<span class="block text-[10.5px] text-destructive" role="alert">{error}</span>{/if}
