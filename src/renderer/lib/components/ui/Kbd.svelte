<script lang="ts">
  import { cn } from '$lib/utils'

  interface Props {
    class?: string
    children?: import('svelte').Snippet
  }

  let { class: className, children }: Props = $props()
</script>

<kbd
  class={cn(
    'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10.5px] text-muted-foreground',
    className
  )}
>
  {@render children?.()}
</kbd>
