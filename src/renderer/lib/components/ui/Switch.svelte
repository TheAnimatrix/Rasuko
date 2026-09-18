<script lang="ts">
  import { Switch } from 'bits-ui'
  import { cn } from '$lib/utils'

  interface Props {
    checked?: boolean
    disabled?: boolean
    class?: string
    id?: string
    onCheckedChange?: (checked: boolean) => void
    'aria-label'?: string
  }

  let { checked = $bindable(false), disabled = false, class: className, id, ...rest }: Props = $props()
</script>

<Switch.Root
  bind:checked
  {disabled}
  {id}
  class={cn(
    'peer inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
    'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input disabled:cursor-not-allowed disabled:opacity-50',
    className
  )}
  {...rest}
>
  <Switch.Thumb
    class="pointer-events-none block size-[14px] rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[2px]"
  />
</Switch.Root>
