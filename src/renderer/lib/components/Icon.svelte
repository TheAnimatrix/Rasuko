<script lang="ts">
  import IconifyIcon, { getIcon } from '@iconify/svelte'
  import { FALLBACK_ICON, iconName } from '$lib/icons'
  import { cn } from '$lib/utils'

  interface Props {
    /** mingcute icon name, with or without the `mingcute:` prefix. */
    name?: string | null
    size?: number | string
    class?: string
    /** Rendered as decorative when the parent already provides a label. */
    decorative?: boolean
    label?: string
  }

  let { name, size = 16, class: className, decorative = true, label }: Props = $props()

  const resolved = $derived.by(() => {
    const candidate = iconName(name)
    return getIcon(candidate) ? candidate : FALLBACK_ICON
  })

  const pixels = $derived(typeof size === 'number' ? `${size}px` : size)
</script>

<IconifyIcon
  icon={resolved}
  width={pixels}
  height={pixels}
  class={cn('shrink-0', className)}
  aria-hidden={decorative ? 'true' : undefined}
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : label}
/>
