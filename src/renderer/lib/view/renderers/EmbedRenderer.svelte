<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import Icon from '$lib/components/Icon.svelte'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
  }

  let { node }: Props = $props()

  const url = $derived(String(prop(node, 'url', '') ?? ''))
  const title = $derived(String(prop(node, 'title', '') ?? ''))
  const description = $derived(String(prop(node, 'description', '') ?? ''))

  const host = $derived.by(() => {
    if (!url) return ''
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })
</script>

{#if !url}
  <div class="rounded-xl border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
    No URL
  </div>
{:else}
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    class="flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/50"
  >
    <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
      <Icon name="link-line" size={15} />
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1">
        <span class="truncate text-[13px] font-medium">{title || host}</span>
        <Icon name="external-link-line" size={12} class="shrink-0 text-muted-foreground" />
      </span>
      {#if description}
        <span class="mt-0.5 block text-[12px] text-muted-foreground">{description}</span>
      {/if}
      <span class="mt-0.5 block truncate text-[11px] text-muted-foreground/70">{url}</span>
    </span>
  </a>
{/if}
