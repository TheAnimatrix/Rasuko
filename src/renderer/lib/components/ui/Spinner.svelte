<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  interface Props {
    size?: number
    class?: string
    label?: string
  }

  let { size = 14, class: className, label }: Props = $props()
</script>

<span
  class={cn('inline-flex items-center justify-center text-muted-foreground', className)}
  role={label ? 'status' : undefined}
  aria-label={label}
>
  <Icon name="loading-3-line" {size} class="animate-spin" />
</span>
