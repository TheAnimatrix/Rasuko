<script lang="ts">
  import { Popover } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  interface Props {
    open?: boolean
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    class?: string
    trigger: Snippet
    children: Snippet
  }

  let {
    open = $bindable(false),
    side = 'bottom',
    align = 'start',
    sideOffset = 6,
    class: className,
    trigger,
    children
  }: Props = $props()
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <span {...props} class="inline-flex">{@render trigger()}</span>
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      {side}
      {align}
      {sideOffset}
      class={cn(
        'z-50 w-64 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className
      )}
    >
      {@render children()}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
