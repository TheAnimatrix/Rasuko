<script lang="ts">
  import { cn } from '$lib/utils'

  interface Props {
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
    class?: string
    children: import('svelte').Snippet
  }

  let { tone = 'neutral', class: className, children }: Props = $props()

  const tones = {
    neutral: 'bg-secondary text-secondary-foreground',
    info: 'bg-info/12 text-info',
    success: 'bg-success/14 text-success',
    warning: 'bg-warning/18 text-warning',
    danger: 'bg-destructive/12 text-destructive'
  }
</script>

<span
  class={cn(
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5',
    tones[tone],
    className
  )}
>
  {@render children()}
</span>
