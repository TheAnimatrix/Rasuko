<script lang="ts">
  /** MessageToolbar copy affordance — icon swaps to a check for 2s. */

  import { ICONS } from '$lib/icon-names'
  import { cn } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'

  interface Props {
    text: string
    class?: string
    label?: string
  }

  let { text, class: className, label = 'Copy response' }: Props = $props()

  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function copy(): void {
    void navigator.clipboard?.writeText(text)
    copied = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      copied = false
      timer = null
    }, 2000)
  }
</script>

<button
  type="button"
  tabindex="-1"
  aria-label={copied ? 'Copied' : label}
  title={copied ? 'Copied' : label}
  onclick={copy}
  class={cn(
    'flex size-6 items-center justify-center rounded-md transition-[background-color,opacity,transform] duration-150 ease-out',
    'bg-transparent opacity-50 hover:bg-foreground/10 hover:opacity-100 active:scale-[0.97]',
    className
  )}
>
  <span class="relative size-3.5">
    <Icon
      name={ICONS.copy}
      size={14}
      class={cn(
        'absolute inset-0 text-muted-foreground transition-[opacity,transform] duration-150 ease-out',
        copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
      )}
    />
    <Icon
      name={ICONS.check}
      size={14}
      class={cn(
        'absolute inset-0 text-muted-foreground transition-[opacity,transform] duration-150 ease-out',
        copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
      )}
    />
  </span>
</button>
