<script lang="ts">
  import { Tooltip } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  interface Props {
    content: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    delay?: number
    class?: string
    children: Snippet
  }

  let { content, side = 'bottom', delay = 400, class: className, children }: Props = $props()
</script>

<Tooltip.Provider delayDuration={delay}>
  <Tooltip.Root>
    <!--
      The trigger is a layout-bearing span rather than `display: contents`:
      a contents element has no box, which breaks hit-testing, and wrapping a
      caller's <button> in bits-ui's own button would nest interactive elements.
    -->
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class={cn('inline-flex', className)}>
          {@render children()}
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        sideOffset={6}
        class="z-50 select-none rounded-md border border-border bg-popover px-2 py-1 text-[11.5px] text-popover-foreground shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      >
        {content}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
