<script lang="ts">
  /**
   * TextShimmer — 21st.dev Agent Elements.
   *
   * A label that sweeps a brighter band across muted text while a turn is
   * running. Transform-free (background-position only), so it stays cheap
   * inside long transcripts.
   */

  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  interface Props {
    class?: string
    duration?: number
    spread?: number
    delay?: number
    children?: Snippet
  }

  let { class: className, duration = 2, spread = 100, delay = 0, children }: Props = $props()

  const style = $derived(
    [
      `--an-shimmer-duration:${duration}s`,
      `--an-shimmer-spread:${spread}px`,
      delay > 0 ? `animation-delay:${delay}s` : '',
      `animation-duration:${duration}s`,
      'animation-iteration-count:infinite',
      'animation-timing-function:linear'
    ]
      .filter(Boolean)
      .join(';')
  )
</script>

<span class={cn('an-text-shimmer an-text-shimmer--active', className)} style={style}>
  {@render children?.()}
</span>
