<script lang="ts">
  import { Separator } from 'bits-ui'
  import { cn } from '$lib/utils'

  interface Props {
    orientation?: 'horizontal' | 'vertical'
    class?: string
  }

  let { orientation = 'horizontal', class: className }: Props = $props()
</script>

<Separator.Root
  {orientation}
  class={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
/>
