<script lang="ts">
  /**
   * SearchRow — read / grep / ls.
   *
   * Collapses to one row and expands to a console-style panel, matching the
   * upstream SearchTool card. The row always names what ran; the panel shows
   * the raw workspace output.
   */

  import type { ChatToolCall } from '@shared/types'
  import ToolRowBase from './ToolRowBase.svelte'
  import { basename, countGrepMatches, isPending, searchRowLabels, stringArg, truncate } from './format'

  interface Props {
    call: ChatToolCall
  }

  let { call }: Props = $props()

  const pending = $derived(isPending(call))
  const path = $derived(stringArg(call.input, 'path'))
  const pattern = $derived(stringArg(call.input, 'pattern'))

  const labels = $derived.by(() => {
    if (call.name === 'grep') {
      return searchRowLabels('Grep', pattern, countGrepMatches(call.output))
    }
    if (call.name === 'read') {
      const file = basename(path) || truncate(path, 40)
      return { completeLabel: 'Read', detail: file }
    }
    return { completeLabel: 'Listed', detail: path || 'workspace' }
  })

  const panelTitle = $derived(
    call.name === 'grep'
      ? `Searched for \u201C${pattern}\u201D`
      : call.name === 'read'
        ? path
        : path || 'Workspace'
  )

  const hasOutput = $derived(Boolean(call.output && call.output.trim()))
</script>

<ToolRowBase
  icon="search-2-line"
  shimmerLabel={call.name === 'grep' ? 'Searching...' : call.name === 'read' ? 'Reading...' : 'Listing...'}
  completeLabel={labels.completeLabel}
  detail={labels.detail}
  isAnimating={pending}
  expandable={hasOutput}
  tone={call.isError ? 'danger' : 'default'}
>
  <div>
    <div
      class="mb-1 flex h-7 items-center gap-1 truncate px-0.5 text-[11.5px] text-muted-foreground"
    >
      <span class="font-medium text-foreground/80">{panelTitle}</span>
    </div>
    <pre
      class="scrollbar-thin max-h-[220px] overflow-auto rounded-[var(--an-tool-border-radius)] border border-border bg-card p-2.5 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/85">{call.output}</pre>
  </div>
</ToolRowBase>
