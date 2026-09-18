<script lang="ts">
  import { cn } from '$lib/utils'

  interface Props {
    value?: string
    placeholder?: string
    type?: string
    disabled?: boolean
    class?: string
    autofocus?: boolean
    oninput?: (event: Event) => void
    onkeydown?: (event: KeyboardEvent) => void
    onfocus?: (event: FocusEvent) => void
    onblur?: (event: FocusEvent) => void
    onpaste?: (event: ClipboardEvent) => void
    'aria-label'?: string
    id?: string
  }

  let {
    value = $bindable(''),
    placeholder,
    type = 'text',
    disabled = false,
    class: className,
    ...rest
  }: Props = $props()
</script>

<input
  bind:value
  {type}
  {placeholder}
  {disabled}
  class={cn(
    'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground transition-colors',
    'placeholder:text-muted-foreground/70 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
    className
  )}
  {...rest}
/>
