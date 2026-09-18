<script lang="ts">
/**
 * The deterministic View runtime.
 *
 * A View is a closed component tree bound to content records. This component is
 * the only public entry point: it reads the root `page` node for width, padding,
 * gap and alignment, then renders the tree through `ViewNode`.
 *
 * It renders presentation only. All data comes from `records`.
 */

import type { ContentRecord, ViewDoc } from '@shared/types'
import { cn } from '$lib/utils'
import ViewNode from './ViewNode.svelte'
import { prop } from './props'

interface Props {
  view: ViewDoc
  records: Record<string, ContentRecord>
  /** `false` renders a fully inert preview (settings, marketplace). */
  editable?: boolean
  class?: string
  /** Called when a node's contextual menu asks for a page-level redesign. */
  onrequestRedesign?: (nodeId: string) => void
}

let { view, records, editable = true, class: className, onrequestRedesign }: Props = $props()

/**
 * Every read of the View goes through this function rather than a `$derived`.
 * A memoized derived on `view.root` served a pre-redesign tree after the
 * assistant replaced the View, which rendered only the nodes that existed
 * before the change. Functions cannot go stale.
 */
const root = () => view.root

const widthClass = $derived.by(() => {
  switch (String(prop(root(), 'width', 'default'))) {
    case 'narrow':
      return 'max-w-2xl'
    case 'wide':
      return 'max-w-5xl'
    case 'full':
      return 'max-w-none'
    default:
      return 'max-w-3xl'
  }
})

const padding = $derived(Math.max(0, Number(prop(root(), 'padding', 40)) || 0))
const gap = $derived(Math.max(0, Number(prop(root(), 'gap', 16)) || 0))
const align = $derived(String(prop(root(), 'align', 'center')))

const rootChildren = () => {
  const node = root()
  return node.type === 'page' ? (node.children ?? []) : [node]
}
</script>

<div class={cn('font-sans text-[14px] leading-relaxed text-foreground', className)}>
  <div
    class={cn(
      'flex w-full flex-col',
      widthClass,
      align === 'start' ? 'mr-auto ml-0' : 'mx-auto'
    )}
    style="gap:{gap}px; padding:{padding}px;"
  >
    {#each rootChildren() as child, index (index)}
      <ViewNode node={child} {records} {editable} {onrequestRedesign} />
    {/each}
  </div>
</div>
