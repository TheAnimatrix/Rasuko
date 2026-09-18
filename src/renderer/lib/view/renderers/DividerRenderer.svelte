<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
  }

  let { node }: Props = $props()

  const label = $derived(String(prop(node, 'label', '') ?? ''))
</script>

<div class="flex items-center gap-3 py-1">
  <span class="h-px flex-1 bg-border"></span>
  {#if label}
    <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <span class="h-px flex-1 bg-border"></span>
  {/if}
</div>
