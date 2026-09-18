<script lang="ts">
/**
 * Renders ONE View node by type and recurses into its children.
 *
 * The type → renderer mapping is an explicit if/else-if chain over the closed
 * registry, so an unknown type degrades to a neutral placeholder instead of
 * crashing. Children are handed to layout renderers as a snippet so there is
 * exactly one recursion path (this component).
 */

import type { ContentRecord, ViewNode as ViewNodeType } from '@shared/types'
import { cn } from '$lib/utils'
import Icon from '$lib/components/Icon.svelte'
import NodeChrome from './NodeChrome.svelte'
import ViewNode from './ViewNode.svelte'

import StackRenderer from './renderers/StackRenderer.svelte'
import RowRenderer from './renderers/RowRenderer.svelte'
import GridRenderer from './renderers/GridRenderer.svelte'
import ColumnsRenderer from './renderers/ColumnsRenderer.svelte'
import SectionRenderer from './renderers/SectionRenderer.svelte'
import TabsRenderer from './renderers/TabsRenderer.svelte'
import DividerRenderer from './renderers/DividerRenderer.svelte'
import SpacerRenderer from './renderers/SpacerRenderer.svelte'

import HeadingRenderer from './renderers/HeadingRenderer.svelte'
import TextRenderer from './renderers/TextRenderer.svelte'
import RichRenderer from './renderers/RichRenderer.svelte'
import CalloutRenderer from './renderers/CalloutRenderer.svelte'
import QuoteRenderer from './renderers/QuoteRenderer.svelte'
import CodeRenderer from './renderers/CodeRenderer.svelte'
import KeyValueRenderer from './renderers/KeyValueRenderer.svelte'

import MetricRenderer from './renderers/MetricRenderer.svelte'
import MetricsRenderer from './renderers/MetricsRenderer.svelte'
import TableRenderer from './renderers/TableRenderer.svelte'
import KanbanRenderer from './renderers/KanbanRenderer.svelte'
import ListRenderer from './renderers/ListRenderer.svelte'
import ChecklistRenderer from './renderers/ChecklistRenderer.svelte'
import FieldsRenderer from './renderers/FieldsRenderer.svelte'
import ProgressRenderer from './renderers/ProgressRenderer.svelte'
import BarChartRenderer from './renderers/BarChartRenderer.svelte'
import LineChartRenderer from './renderers/LineChartRenderer.svelte'
import DonutChartRenderer from './renderers/DonutChartRenderer.svelte'
import TimelineRenderer from './renderers/TimelineRenderer.svelte'
import CalendarRenderer from './renderers/CalendarRenderer.svelte'
import BadgeRenderer from './renderers/BadgeRenderer.svelte'
import ButtonRenderer from './renderers/ButtonRenderer.svelte'

import ImageRenderer from './renderers/ImageRenderer.svelte'
import GalleryRenderer from './renderers/GalleryRenderer.svelte'
import EmbedRenderer from './renderers/EmbedRenderer.svelte'

interface Props {
  node: ViewNodeType
  records: Record<string, ContentRecord>
  editable?: boolean
  onrequestRedesign?: (nodeId: string) => void
}

let { node, records, editable = true, onrequestRedesign }: Props = $props()
</script>

{#snippet childNodes(params?: { activeTab?: number })}
  {#each node.children ?? [] as child, index (child.id)}
    {#if node.type === 'tabs'}
      <div
        class={cn(
          'min-w-0',
          params?.activeTab !== undefined && params.activeTab !== index && 'hidden'
        )}
      >
        <ViewNode node={child} {records} {editable} {onrequestRedesign} />
      </div>
    {:else if node.type === 'row'}
      <div class="min-w-0 flex-1">
        <ViewNode node={child} {records} {editable} {onrequestRedesign} />
      </div>
    {:else if node.type === 'metrics' || node.type === 'columns'}
      <div class="min-w-0">
        <ViewNode node={child} {records} {editable} {onrequestRedesign} />
      </div>
    {:else}
      <ViewNode node={child} {records} {editable} {onrequestRedesign} />
    {/if}
  {/each}
{/snippet}

<NodeChrome {node} {records} {editable} {onrequestRedesign}>
  {#if node.type === 'page' || node.type === 'stack'}
    <StackRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'row'}
    <RowRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'grid'}
    <GridRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'columns'}
    <ColumnsRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'section'}
    <SectionRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'tabs'}
    <TabsRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'divider'}
    <DividerRenderer {node} {records} />
  {:else if node.type === 'spacer'}
    <SpacerRenderer {node} {records} />

  {:else if node.type === 'heading'}
    <HeadingRenderer {node} {records} {editable} />
  {:else if node.type === 'text'}
    <TextRenderer {node} {records} {editable} />
  {:else if node.type === 'rich'}
    <RichRenderer {node} {records} {editable} />
  {:else if node.type === 'callout'}
    <CalloutRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'quote'}
    <QuoteRenderer {node} {records} {editable} />
  {:else if node.type === 'code'}
    <CodeRenderer {node} {records} {editable} />
  {:else if node.type === 'keyvalue'}
    <KeyValueRenderer {node} {records} {editable} />

  {:else if node.type === 'metric'}
    <MetricRenderer {node} {records} {editable} />
  {:else if node.type === 'metrics'}
    <MetricsRenderer {node} {records} {editable} children={childNodes} />
  {:else if node.type === 'table'}
    <TableRenderer {node} {records} {editable} />
  {:else if node.type === 'kanban'}
    <KanbanRenderer {node} {records} {editable} />
  {:else if node.type === 'list'}
    <ListRenderer {node} {records} {editable} />
  {:else if node.type === 'checklist'}
    <ChecklistRenderer {node} {records} {editable} />
  {:else if node.type === 'fields'}
    <FieldsRenderer {node} {records} {editable} />
  {:else if node.type === 'progress'}
    <ProgressRenderer {node} {records} {editable} />
  {:else if node.type === 'chart.bar'}
    <BarChartRenderer {node} {records} {editable} />
  {:else if node.type === 'chart.line'}
    <LineChartRenderer {node} {records} {editable} />
  {:else if node.type === 'chart.donut'}
    <DonutChartRenderer {node} {records} {editable} />
  {:else if node.type === 'timeline'}
    <TimelineRenderer {node} {records} {editable} />
  {:else if node.type === 'calendar'}
    <CalendarRenderer {node} {records} {editable} />
  {:else if node.type === 'badge'}
    <BadgeRenderer {node} {records} />
  {:else if node.type === 'button'}
    <ButtonRenderer {node} {records} {editable} />

  {:else if node.type === 'image'}
    <ImageRenderer {node} {records} {editable} />
  {:else if node.type === 'gallery'}
    <GalleryRenderer {node} {records} {editable} />
  {:else if node.type === 'embed'}
    <EmbedRenderer {node} {records} {editable} />

  {:else}
    <div
      class="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground"
    >
      <Icon name="alert-line" size={14} />
      <span>Unsupported component</span>
      <span class="font-mono text-[11px] text-muted-foreground/70">{node.type}</span>
    </div>
  {/if}
</NodeChrome>
