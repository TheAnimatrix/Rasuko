<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { cn } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import RichText from '../RichText.svelte'
  import { bindingDoc, prop, toneBorder, toneText } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
    editable?: boolean
    children?: Snippet
  }

  let { node, records, children }: Props = $props()

  const tone = $derived(prop(node, 'tone', 'info'))
  const title = $derived(String(prop(node, 'title', '') ?? ''))
  const icon = $derived(String(prop(node, 'icon', '') ?? ''))
  const doc = $derived(bindingDoc(records, node.bind))

  const TONE_ICON: Record<string, string> = {
    neutral: 'information-line',
    info: 'information-line',
    success: 'check-circle-line',
    warning: 'warning-line',
    danger: 'close-circle-line'
  }

  const resolvedIcon = $derived(icon || TONE_ICON[String(tone)] || TONE_ICON.info)
</script>

<div class={cn('flex gap-3 rounded-xl border px-3.5 py-3', toneBorder(tone))}>
  <Icon name={resolvedIcon} size={16} class={cn('mt-0.5 shrink-0', toneText(tone))} />
  <div class="min-w-0 flex-1 space-y-2">
    {#if title}
      <p class={cn('text-[13px] font-semibold', toneText(tone))}>{title}</p>
    {/if}
    {#if doc}
      <RichText {doc} />
    {:else}
      {@render children?.()}
    {/if}
  </div>
</div>
