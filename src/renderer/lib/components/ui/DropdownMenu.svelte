<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  export interface MenuItem {
    id: string
    label: string
    icon?: string
    shortcut?: string
    danger?: boolean
    disabled?: boolean
    separatorBefore?: boolean
  }

  interface Props {
    items: MenuItem[]
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    class?: string
    onselect: (id: string) => void
    trigger: Snippet
  }

  let { items, side = 'bottom', align = 'start', class: className, onselect, trigger }: Props = $props()
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <span {...props} class="inline-flex">{@render trigger()}</span>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      {side}
      {align}
      sideOffset={6}
      class={cn(
        'z-50 min-w-[11rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className
      )}
    >
      {#each items as item (item.id)}
        {#if item.separatorBefore}
          <DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />
        {/if}
        <DropdownMenu.Item
          disabled={item.disabled}
          onSelect={() => onselect(item.id)}
          class={cn(
            'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] outline-none select-none',
            'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
            'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
            item.danger && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive'
          )}
        >
          {#if item.icon}
            <Icon name={item.icon} size={14} class="text-muted-foreground" />
          {/if}
          <span class="flex-1 truncate">{item.label}</span>
          {#if item.shortcut}
            <span class="font-mono text-[10.5px] text-muted-foreground">{item.shortcut}</span>
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
