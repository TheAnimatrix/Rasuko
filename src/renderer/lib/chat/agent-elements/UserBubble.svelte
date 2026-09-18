<script lang="ts">
  /** UserBubble — the right-aligned prompt. */

  import { cn } from '$lib/utils'

  interface Props {
    text: string
    class?: string
  }

  let { text, class: className }: Props = $props()
</script>

<div class={cn('flex flex-col items-end', className)}>
  <div
    class="max-w-[88%] rounded-[var(--an-message-border-radius)] rounded-br-[var(--an-message-radius-inner-offset)] bg-secondary px-[var(--an-user-message-x)] py-[var(--an-user-message-y)] text-[13px] text-foreground select-text"
  >
    <p class="leading-6 break-words whitespace-pre-wrap">{text}</p>
  </div>
</div>
