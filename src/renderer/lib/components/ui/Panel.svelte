<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  interface Props {
    title: string
    description?: string
    icon?: string
    class?: string
    action?: Snippet
    children?: Snippet
  }

  let { title, description, icon, class: className, action, children }: Props = $props()
</script>

<div class={cn('rounded-lg border border-border bg-card', className)}>
  <div class="flex items-center gap-2.5 px-3.5 py-2.5">
    {#if icon}
      <span class="flex size-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <Icon name={icon} size={14} />
      </span>
    {/if}
    <div class="min-w-0 flex-1">
      <h3 class="truncate text-[13px] font-medium leading-5">{title}</h3>
      {#if description}
        <p class="truncate text-[11.5px] text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if action}{@render action()}{/if}
  </div>
  {#if children}
    <div class="border-t border-border px-3.5 py-3">{@render children()}</div>
  {/if}
</div>
