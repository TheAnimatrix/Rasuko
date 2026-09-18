<script lang="ts">
  /**
   * AssistantMarkdown — the 21st.dev Agent Elements markdown rhythm, rendered
   * from Rasuko's own tiny parser. Blocks (headings, lists, fenced code,
   * quotes) keep chat prose readable without a Markdown dependency.
   */

  import type { Inline } from './markdown'
  import { parseMarkdown } from './markdown'
  import { cn } from '$lib/utils'
  import CopyButton from './CopyButton.svelte'

  interface Props {
    content: string
    class?: string
    muted?: boolean
  }

  let { content, class: className, muted = false }: Props = $props()

  const blocks = $derived(parseMarkdown(content))
</script>

{#snippet inline(tokens: Inline[])}
  {#each tokens as token, index (index)}
    {#if token.type === 'code'}
      <code
        class="an-md-code rounded border border-border bg-secondary px-1 py-px text-[0.85em] text-foreground"
        >{token.value}</code
      >
    {:else if token.type === 'strong'}
      <strong class="font-medium text-foreground">{token.value}</strong>
    {:else if token.type === 'em'}
      <em>{token.value}</em>
    {:else if token.type === 'link'}
      <a
        href={token.href}
        target="_blank"
        rel="noopener noreferrer"
        class="text-[var(--rasuko-accent)] underline-offset-2 hover:underline">{token.value}</a
      >
    {:else}
      <span class="whitespace-pre-wrap break-words">{token.value}</span>
    {/if}
  {/each}
{/snippet}

<div class={cn('an-markdown min-w-0', muted && 'text-muted-foreground', className)}>
  {#each blocks as block, index (index)}
    {#if block.type === 'heading'}
      {#if block.level === 1}
        <h1 class="an-md-h1 mb-2 mt-4 text-[17px] font-semibold">{@render inline(block.inline)}</h1>
      {:else if block.level === 2}
        <h2 class="an-md-h2 mb-1.5 mt-4 text-[15px] font-semibold">
          {@render inline(block.inline)}
        </h2>
      {:else}
        <h3 class="an-md-h3 mb-1.5 mt-3 text-[13.5px] font-semibold">
          {@render inline(block.inline)}
        </h3>
      {/if}
    {:else if block.type === 'paragraph'}
      <p class="an-md-p text-[13px]">{@render inline(block.inline)}</p>
    {:else if block.type === 'code'}
      <div
        class="my-2 overflow-hidden rounded-[var(--an-tool-border-radius)] border border-border bg-card"
      >
        <div
          class="flex h-7 items-center gap-2 border-b border-border bg-secondary px-2.5 text-[11px] text-muted-foreground"
        >
          <span class="font-mono">{block.language || 'text'}</span>
          <CopyButton text={block.code} />
        </div>
        <pre
          class="scrollbar-thin max-h-[320px] overflow-auto bg-card px-2.5 py-2 font-mono text-[12px] leading-[1.5] text-foreground"><code
            >{block.code}</code
          ></pre>
      </div>
    {:else if block.type === 'list'}
      {#if block.ordered}
        <ol class="an-md-ol list-decimal list-outside text-[13px]">
          {#each block.items as item, itemIndex (itemIndex)}
            <li class="an-md-li pl-1">{@render inline(item)}</li>
          {/each}
        </ol>
      {:else}
        <ul class="an-md-ul list-disc list-outside text-[13px]">
          {#each block.items as item, itemIndex (itemIndex)}
            <li class="an-md-li pl-1">{@render inline(item)}</li>
          {/each}
        </ul>
      {/if}
    {:else if block.type === 'quote'}
      <blockquote class="an-md-blockquote my-2 border-l-2 border-border pl-3 text-[13px] italic">
        {@render inline(block.inline)}
      </blockquote>
    {:else if block.type === 'divider'}
      <hr class="an-md-hr my-3 border-border" />
    {/if}
  {/each}
</div>
