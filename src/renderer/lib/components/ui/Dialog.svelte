<script lang="ts">
  import { Dialog } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  interface Props {
    open?: boolean
    title?: string
    description?: string
    class?: string
    footer?: Snippet
    children: Snippet
  }

  let { open = $bindable(false), title, description, class: className, footer, children }: Props = $props()
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
    />
    <Dialog.Content
      class={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
        'rounded-xl border border-border bg-card p-5 shadow-2xl outline-none',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className
      )}
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          {#if title}
            <Dialog.Title class="text-[15px] font-semibold tracking-tight">{title}</Dialog.Title>
          {/if}
          {#if description}
            <Dialog.Description class="mt-1 text-[12.5px] text-muted-foreground">
              {description}
            </Dialog.Description>
          {/if}
        </div>
        <Dialog.Close
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Close"
        >
          <Icon name="close-line" size={14} />
        </Dialog.Close>
      </div>
      <div class="mt-4">{@render children()}</div>
      {#if footer}
        <div class="mt-5 flex items-center justify-end gap-2">{@render footer()}</div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
