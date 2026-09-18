<script lang="ts">
  /** GenericToolRow — the fallback every tool maps to. */

  import ToolRowBase from './ToolRowBase.svelte'

  interface Props {
    icon?: string
    label: string
    pendingLabel?: string
    subtitle?: string
    pending?: boolean
  }

  let { icon, label, pendingLabel, subtitle, pending = false }: Props = $props()
</script>

<ToolRowBase
  {icon}
  shimmerLabel={pendingLabel ?? `Running ${label}`}
  completeLabel={label}
  isAnimating={pending}
  detail={subtitle}
/>
