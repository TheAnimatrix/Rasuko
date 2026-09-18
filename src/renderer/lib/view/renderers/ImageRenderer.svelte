<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import { bindingRecord, prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node }: Props = $props()

  const src = $derived(String(prop(node, 'src', '') ?? ''))
  const alt = $derived(String(prop(node, 'alt', '') ?? ''))
  const caption = $derived(String(prop(node, 'caption', '') ?? ''))
  const fit = $derived(String(prop(node, 'fit', 'cover')))
  const height = $derived(Math.min(600, Math.max(60, Number(prop(node, 'height', 180)) || 180)))
</script>

{#if !src}
  <div
    class="flex items-center justify-center rounded-xl border border-dashed border-border text-[12px] text-muted-foreground"
    style="height:{height}px;"
  >
    No image source
  </div>
{:else}
  <figure class="space-y-1.5">
    <img
      {src}
      {alt}
      loading="lazy"
      class={cn(
        'w-full rounded-xl border border-border',
        fit === 'contain' ? 'object-contain' : 'object-cover'
      )}
      style="height:{height}px;"
    />
    {#if caption}
      <figcaption class="text-[11.5px] text-muted-foreground">{caption}</figcaption>
    {/if}
  </figure>
{/if}
