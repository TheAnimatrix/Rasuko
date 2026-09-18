<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  interface Option {
    value: string
    label: string
  }

  interface Props {
    value?: string
    options: Option[]
    placeholder?: string
    disabled?: boolean
    class?: string
    id?: string
    onchange?: (value: string) => void
    'aria-label'?: string
  }

  let {
    value = $bindable(''),
    options,
    placeholder = 'Select…',
    disabled = false,
    class: className,
    id,
    onchange,
    ...rest
  }: Props = $props()

  function handleChange(event: Event) {
    const next = (event.currentTarget as HTMLSelectElement).value
    value = next
    onchange?.(next)
  }
</script>

<div class={cn('relative', className)}>
  <select
    {id}
    {disabled}
    {value}
    onchange={handleChange}
    class={cn(
      'h-8 w-full cursor-pointer appearance-none rounded-md border border-input bg-background pl-2.5 pr-7 text-[13px] text-foreground transition-colors',
      'focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50'
    )}
    {...rest}
  >
    {#if placeholder}
      <option value="" disabled>{placeholder}</option>
    {/if}
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <Icon
    name="down-small-line"
    size={14}
    class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
  />
</div>
