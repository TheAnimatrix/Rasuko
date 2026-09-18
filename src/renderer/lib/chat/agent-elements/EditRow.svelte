<script lang="ts">
  /**
   * EditRow — write.
   *
   * A file card: "Creating/Edited <file>" with a byte count, expanding to the
   * written payload. Mousse pairs this with a shiki diff; Rasuko's write tool
   * carries only the new contents, so the body is the payload as written.
   */

  import type { ChatToolCall } from '@shared/types'
  import ToolRowBase from './ToolRowBase.svelte'
  import { basename, isPending, stringArg } from './format'

  interface Props {
    call: ChatToolCall
  }

  let { call }: Props = $props()

  const path = $derived(stringArg(call.input, 'path'))
  const fileName = $derived(basename(path) || path || 'file')
  const content = $derived(stringArg(call.input, 'content'))
  const pending = $derived(isPending(call))
  const isError = $derived(Boolean(call.isError))

  const completeLabel = $derived(
    isError ? `Failed ${fileName}` : `${call.name === 'write' ? 'Created' : 'Edited'} ${fileName}`
  )
  const shimmerLabel = $derived(`Writing ${fileName}`)
</script>

<ToolRowBase
  icon={isError ? 'close-circle-line' : 'edit-2-line'}
  {shimmerLabel}
  {completeLabel}
  isAnimating={pending}
  tone={isError ? 'danger' : 'default'}
  expandable={content.length > 0}
>
  {#snippet trailing()}
    <span class="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
      {content.length} B
    </span>
  {/snippet}
  <pre
    class="scrollbar-thin max-h-[280px] overflow-auto rounded-[var(--an-tool-border-radius)] border border-border bg-card p-2.5 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/85">{content}</pre>
</ToolRowBase>
