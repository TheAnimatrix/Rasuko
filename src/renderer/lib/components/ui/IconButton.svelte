<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { cn } from '$lib/utils'

  interface Props {
    icon: string
    label: string
    size?: number
    variant?: 'ghost' | 'subtle' | 'outline'
    disabled?: boolean
    active?: boolean
    class?: string
    onclick?: (event: MouseEvent) => void
  }

  let {
    icon,
    label,
    size = 16,
    variant = 'ghost',
    disabled = false,
    active = false,
    class: className,
    onclick
  }: Props = $props()

  const variants = {
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    subtle: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline: 'border border-border hover:bg-accent hover:text-accent-foreground'
  }
</script>

<button
  type="button"
  {disabled}
  {onclick}
  title={label}
  aria-label={label}
  aria-pressed={active}
  class={cn(
    'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-40',
    variants[variant],
    active && 'bg-accent text-accent-foreground',
    className
  )}
>
  <Icon name={icon} {size} />
</button>
