<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  interface Props {
    variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
    size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    class?: string
    title?: string
    'aria-label'?: string
    onclick?: (event: MouseEvent) => void
    children?: Snippet
  }

  let {
    variant = 'default',
    size = 'md',
    type = 'button',
    disabled = false,
    class: className,
    onclick,
    children,
    ...rest
  }: Props = $props()

  const base =
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none'

  const variants: Record<NonNullable<Props['variant']>, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline: 'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    link: 'text-primary underline-offset-4 hover:underline'
  }

  const sizes: Record<NonNullable<Props['size']>, string> = {
    sm: 'h-7 px-2.5 text-[12.5px]',
    md: 'h-8 px-3 text-[13px]',
    lg: 'h-10 px-4 text-sm',
    icon: 'size-8',
    'icon-sm': 'size-7'
  }
</script>

<button
  {type}
  {disabled}
  {onclick}
  class={cn(base, variants[variant], sizes[size], className)}
  {...rest}
>
  {@render children?.()}
</button>
