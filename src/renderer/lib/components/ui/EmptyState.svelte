<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  interface Props {
    icon?: string
    title: string
    description?: string
    class?: string
    action?: Snippet
  }

  let { icon = 'inbox-line', title, description, class: className, action }: Props = $props()
</script>

<div class={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
  <span class="mb-3 flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
    <Icon name={icon} size={20} />
  </span>
  <p class="text-[13.5px] font-medium">{title}</p>
  {#if description}
    <p class="mt-1 max-w-sm text-[12.5px] text-muted-foreground text-pretty">{description}</p>
  {/if}
  {#if action}
    <div class="mt-4">{@render action()}</div>
  {/if}
</div>
