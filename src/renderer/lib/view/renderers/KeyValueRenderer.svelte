<script lang="ts">
  import type { ContentRecord, TableCellValue, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { bindingRecord, prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node, records, editable = true }: Props = $props()

  const record = $derived(bindingRecord(records, node.bind))
  const columns = $derived(Math.min(4, Math.max(1, Number(prop(node, 'columns', 2)) || 2)))

  const fields = $derived.by(() => {
    if (!record || record.kind !== 'fields') return []
    const field = node.bind?.field
    return field
      ? record.fields.filter((candidate) => candidate.id === field || candidate.name === field)
      : record.fields
  })
  const values = $derived(record && record.kind === 'fields' ? record.values : {})

  const COLUMNS: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4'
  }

  function display(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    return String(value)
  }

  function setValue(fieldId: string, value: TableCellValue): void {
    if (!editable || !record || record.kind !== 'fields') return
    void workspace.updateRecord(record.id, { values: { ...record.values, [fieldId]: value } })
  }
</script>

{#if fields.length === 0}
  <p class="text-[12.5px] text-muted-foreground/50">No fields bound</p>
{:else}
  <dl class={cn('grid gap-x-5 gap-y-2.5', COLUMNS[columns])}>
    {#each fields as field (field.id)}
      <div class="min-w-0">
        <dt class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {field.name}
        </dt>
        <dd class="text-[13px]">
          {#if editable && field.type === 'checkbox'}
            <input
              type="checkbox"
              class="size-4 accent-[var(--color-primary)]"
              checked={Boolean(values[field.id])}
              aria-label={field.name}
              onchange={(event) => setValue(field.id, event.currentTarget.checked)}
            />
          {:else if editable && field.type === 'select'}
            <select
              class="h-7 w-full rounded border border-input bg-background px-1.5 text-[12.5px]"
              value={String(values[field.id] ?? '')}
              aria-label={field.name}
              onchange={(event) => setValue(field.id, event.currentTarget.value)}
            >
              <option value="">—</option>
              {#each field.options ?? [] as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else if editable}
            <input
              type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'}
              class="h-7 w-full rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-border focus:border-ring"
              value={String(values[field.id] ?? '')}
              aria-label={field.name}
              oninput={(event) => {
                const raw = event.currentTarget.value
                setValue(field.id, field.type === 'number' ? (raw === '' ? null : Number(raw)) : raw)
              }}
            />
          {:else}
            <span class="block truncate">{display(values[field.id])}</span>
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
{/if}
