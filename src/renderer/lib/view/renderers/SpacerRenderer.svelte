<script lang="ts">
  import type { ContentRecord, ViewNode } from '@shared/types'
  import { prop } from '../props'

  interface Props {
    node: ViewNode
    records: Record<string, ContentRecord>
  }

  let { node }: Props = $props()

  const size = $derived(Math.max(4, Number(prop(node, 'size', 24)) || 24))
</script>

<div aria-hidden="true" style="height:{size}px;"></div>
