<script lang="ts">
  /**
   * ThinkingRow — the model's reasoning, collapsed to a single row.
   * Shimmers as "Thinking", rests as "Thought" with the first line as detail.
   */

  import ToolRowBase from './ToolRowBase.svelte'
  import AssistantMarkdown from './AssistantMarkdown.svelte'
  import { thoughtHeading } from './format'

  interface Props {
    text: string
    pending?: boolean
  }

  let { text, pending = false }: Props = $props()
</script>

<ToolRowBase
  icon="bulb-line"
  shimmerLabel="Thinking"
  completeLabel="Thought"
  detail={thoughtHeading(text)}
  isAnimating={pending}
  expandable={text.trim().length > 0}
>
  <div class="scrollbar-thin max-h-[175px] overflow-y-auto">
    <AssistantMarkdown content={text} muted />
  </div>
</ToolRowBase>
