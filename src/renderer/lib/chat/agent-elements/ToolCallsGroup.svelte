<script lang="ts">
  /**
   * ToolCallsGroup — 21st.dev Agent Elements.
   *
   * Collapsible wrapper for consecutive tool calls: "Tool calls N >". Stays
   * collapsed by default even while streaming (a manual toggle opens it), so a
   * long tool loop never buries the assistant's prose.
   */

  import type { Snippet } from 'svelte'
  import ToolRowBase from './ToolRowBase.svelte'

  interface Props {
    count: number
    /** True while the turn is streaming — drives the shimmer. */
    autoOpen?: boolean
    children?: Snippet
  }

  let { count, autoOpen = false, children }: Props = $props()
</script>

<ToolRowBase
  completeLabel="Tool calls"
  shimmerLabel="Tool calls"
  detail={`${count}`}
  isAnimating={autoOpen}
  expandable
>
  <div class="ml-1.5 flex flex-col gap-2.5 border-l border-border pl-3">
    {@render children?.()}
  </div>
</ToolRowBase>
