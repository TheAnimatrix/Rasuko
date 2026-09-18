<script lang="ts">
/**
 * Read-only renderer for a RichDoc.
 *
 * Content is stored as blocks with inline runs (never Markdown, never HTML), so
 * every renderer that displays a bound document funnels through here. This keeps
 * heading / quote / callout / code / document rendering identical.
 */

import type { Block, Mark, RichDoc, Run } from '@shared/richtext'
import { cn } from '$lib/utils'
import Icon from '$lib/components/Icon.svelte'

interface Props {
  doc?: RichDoc | null
  placeholder?: string
  class?: string
  /** Force heading blocks to this level (used by the `heading` component). */
  level?: number
}

let { doc, placeholder = '', class: className, level }: Props = $props()

function linkOf(run: Run): string | undefined {
  for (const mark of run.marks ?? []) {
    if (typeof mark === 'object' && 'link' in mark) return mark.link
  }
  return undefined
}

function colorOf(run: Run): string | undefined {
  for (const mark of run.marks ?? []) {
    if (typeof mark === 'object' && 'color' in mark) return mark.color
  }
  return undefined
}

function markClasses(run: Run): string {
  const classes: string[] = []
  for (const mark of run.marks ?? []) {
    if (typeof mark === 'object') continue
    switch (mark as Mark) {
      case 'bold':
        classes.push('font-semibold')
        break
      case 'italic':
        classes.push('italic')
        break
      case 'strike':
        classes.push('line-through')
        break
      case 'underline':
        classes.push('underline underline-offset-2')
        break
      case 'code':
        classes.push('rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]')
        break
      default:
        break
    }
  }
  return classes.join(' ')
}

const blocks = $derived(doc?.blocks ?? [])

interface ListGroup {
  kind: 'list'
  ordered: boolean
  items: Array<Extract<Block, { type: 'bullet' | 'numbered' | 'todo' }>>
}
interface SingleGroup {
  kind: 'single'
  block: Block
}
type Group = ListGroup | SingleGroup

const groups = $derived.by<Group[]>(() => {
  const out: Group[] = []
  for (const block of blocks) {
    if (block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo') {
      const ordered = block.type === 'numbered'
      const last = out[out.length - 1]
      if (last && last.kind === 'list' && last.ordered === ordered) last.items.push(block)
      else out.push({ kind: 'list', ordered, items: [block] })
    } else {
      out.push({ kind: 'single', block })
    }
  }
  return out
})

function headingClass(level: number): string {
  switch (level) {
    case 1:
      return 'text-[22px] font-semibold tracking-tight leading-snug'
    case 2:
      return 'text-[17px] font-semibold tracking-tight leading-snug'
    case 3:
      return 'text-[15px] font-semibold leading-snug'
    default:
      return 'text-[13.5px] font-semibold uppercase tracking-wide text-muted-foreground'
  }
}
</script>

{#snippet inline(runs: Run[])}
  {#each runs as run, index (index)}
    {@const link = linkOf(run)}
    {#if link}
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        class={cn('text-info underline underline-offset-2', markClasses(run))}
        style={colorOf(run) ? `color:${colorOf(run)}` : undefined}>{run.text}</a
      >
    {:else}
      <span class={markClasses(run)} style={colorOf(run) ? `color:${colorOf(run)}` : undefined}
        >{run.text}</span
      >
    {/if}
  {/each}
{/snippet}

<div class={cn('space-y-3 break-words', className)}>
  {#if groups.length === 0}
    {#if placeholder}
      <p class="text-muted-foreground">{placeholder}</p>
    {/if}
  {:else}
    {#each groups as group, groupIndex (groupIndex)}
      {#if group.kind === 'list'}
        {#if group.ordered}
          <ol class="ml-4 list-decimal space-y-1.5">
            {#each group.items as item (item.id)}
              <li class={item.indent ? 'ml-4' : ''}>{@render inline(item.runs)}</li>
            {/each}
          </ol>
        {:else}
          <ul class="ml-4 list-disc space-y-1.5">
            {#each group.items as item (item.id)}
              <li class={cn('marker:text-muted-foreground', item.indent ? 'ml-4' : '')}>
                {#if item.type === 'todo'}
                  <span class="inline-flex items-start gap-2">
                    <Icon
                      name={item.checked ? 'checkbox-fill' : 'checkbox-line'}
                      size={15}
                      class={cn('mt-0.5', item.checked ? 'text-success' : 'text-muted-foreground')}
                    />
                    <span class={item.checked ? 'text-muted-foreground line-through' : ''}
                      >{@render inline(item.runs)}</span
                    >
                  </span>
                {:else}
                  {@render inline(item.runs)}
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else if group.block.type === 'paragraph'}
        {#if level}
          <svelte:element this={`h${level}`} class={headingClass(level)}>
            {@render inline(group.block.runs)}
          </svelte:element>
        {:else}
          <p class="text-pretty">{@render inline(group.block.runs)}</p>
        {/if}
      {:else if group.block.type === 'heading'}
        {@const headingLevel = level ?? group.block.level}
        <svelte:element this={`h${headingLevel}`} class={headingClass(headingLevel)}>
          {@render inline(group.block.runs)}
        </svelte:element>
      {:else if group.block.type === 'quote'}
        <blockquote class="border-l-2 border-border pl-3 text-muted-foreground italic">
          {@render inline(group.block.runs)}
        </blockquote>
      {:else if group.block.type === 'code'}
        <pre
          class="overflow-x-auto rounded-lg border border-border bg-secondary/50 p-3 font-mono text-[12px] leading-relaxed"><code
            >{group.block.text}</code
          ></pre>
      {:else if group.block.type === 'callout'}
        <div
          class={cn(
            'flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]',
            group.block.tone === 'danger'
              ? 'border-destructive/25 bg-destructive/6 text-destructive'
              : group.block.tone === 'warning'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : group.block.tone === 'success'
                  ? 'border-success/25 bg-success/8 text-success'
                  : 'border-info/25 bg-info/6 text-info'
          )}
        >
          <Icon
            name={group.block.tone === 'danger'
              ? 'close-circle-line'
              : group.block.tone === 'warning'
                ? 'warning-line'
                : group.block.tone === 'success'
                  ? 'check-circle-line'
                  : 'information-line'}
            size={15}
            class="mt-0.5"
          />
          <div class="min-w-0 flex-1">{@render inline(group.block.runs)}</div>
        </div>
      {:else if group.block.type === 'divider'}
        <hr class="border-border" />
      {:else if group.block.type === 'image'}
        <figure class="space-y-1.5">
          <img
            src={group.block.src}
            alt={group.block.alt ?? ''}
            class="max-h-80 w-full rounded-lg object-cover"
          />
          {#if group.block.alt}
            <figcaption class="text-[11.5px] text-muted-foreground">{group.block.alt}</figcaption>
          {/if}
        </figure>
      {:else if group.block.type === 'table'}
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-[12.5px]">
            <tbody>
              {#each group.block.rows as row, rowIndex (rowIndex)}
                <tr class="border-b border-border last:border-0">
                  {#each row as cell, cellIndex (cellIndex)}
                    {#if group.block.header && rowIndex === 0}
                      <th class="px-2 py-1.5 text-left font-medium">{@render inline(cell)}</th>
                    {:else}
                      <td class="px-2 py-1.5">{@render inline(cell)}</td>
                    {/if}
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/each}
  {/if}
</div>
