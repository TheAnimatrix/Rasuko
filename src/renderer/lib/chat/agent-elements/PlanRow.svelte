<script lang="ts">
  /**
   * PlanRow — view.applyOps.
   *
   * The architect's structural edit: a deterministic op list against the
   * closed component registry. The row names it, the panel shows the ops and
   * the receipt so a redesign is auditable from the transcript.
   */

  import type { ChatToolCall } from '@shared/types'
  import ToolRowBase from './ToolRowBase.svelte'
  import { isPending, stringArg, truncate } from './format'

  interface Props {
    call: ChatToolCall
  }

  let { call }: Props = $props()

  const ops = $derived(call.input?.ops)
  const opCount = $derived(
    Array.isArray(ops) ? ops.length : typeof ops === 'number' ? ops : null
  )
  const summary = $derived(stringArg(call.input, 'summary'))
  const pending = $derived(isPending(call))
  const isError = $derived(Boolean(call.isError))

  const completeLabel = $derived(
    isError ? 'Redesign failed' : pending ? 'Redesigning view' : 'Redesigned view'
  )
  const detail = $derived(
    summary ? truncate(summary, 58) : opCount !== null ? `${opCount} ops` : ''
  )

  const body = $derived.by(() => {
    if (Array.isArray(ops)) {
      const detailed = ops.some((op) => op && typeof op === 'object' && Object.keys(op).length > 1)
      if (detailed) return JSON.stringify(ops, null, 2)
    }
    return call.output ?? ''
  })
</script>

<ToolRowBase
  icon="layers-line"
  shimmerLabel="Redesigning view"
  {completeLabel}
  {detail}
  isAnimating={pending}
  tone={isError ? 'danger' : 'default'}
  expandable={body.trim().length > 0}
>
  {#snippet trailing()}
    {#if opCount !== null}
      <span class="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
        {opCount} ops
      </span>
    {/if}
  {/snippet}
  <pre
    class="scrollbar-thin max-h-[280px] overflow-auto rounded-[var(--an-tool-border-radius)] border border-border bg-card p-2.5 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/85">{body}</pre>
</ToolRowBase>
