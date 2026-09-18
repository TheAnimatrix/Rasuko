<script lang="ts">
  import { cn } from '$lib/utils'

  interface Props {
    value?: string
    placeholder?: string
    rows?: number
    disabled?: boolean
    class?: string
    oninput?: (event: Event) => void
    onkeydown?: (event: KeyboardEvent) => void
    onblur?: (event: FocusEvent) => void
    'aria-label'?: string
  }

  let { value = $bindable(''), placeholder, rows = 3, disabled = false, class: className, ...rest }: Props =
    $props()
</script>

<textarea
  bind:value
  {placeholder}
  {rows}
  {disabled}
  class={cn(
    'w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[13px] text-foreground transition-colors',
    'placeholder:text-muted-foreground/70 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
    className
  )}
  {...rest}
></textarea>
