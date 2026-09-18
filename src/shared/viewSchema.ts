/**
 * The Rasuko component registry.
 *
 * This is a CLOSED set. The assistant never generates HTML, CSS or JS — it emits
 * view ops against these component types with typed props. That is what makes
 * AI-generated interfaces deterministic, reproducible and safe to apply.
 *
 * Adding a component here makes it available to the AI, the UI picker, and any
 * marketplace View in one place.
 */

import type { RecordKind } from './types'

export type PropKind =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'color'
  | 'icon'
  | 'stringList'
  | 'node'

export interface PropSpec {
  kind: PropKind
  label: string
  default?: unknown
  values?: readonly string[]
  min?: number
  max?: number
  required?: boolean
  help?: string
}

export type ComponentCategory = 'layout' | 'content' | 'data' | 'media'

export interface ComponentSpec {
  type: string
  label: string
  /** mingcute icon name, e.g. `grid-line` */
  icon: string
  category: ComponentCategory
  /** Which child component types are legal. `null` means it cannot have children. */
  accepts: readonly string[] | 'any' | null
  /** Content binding capability. */
  bindable: false | readonly RecordKind[] | 'block'
  summary: string
  props: Record<string, PropSpec>
  /** Guidance handed to the model when planning. */
  aiHint?: string
  example?: Record<string, unknown>
  /** Runtime behavior exposed to planners and inspectors; never passed as renderer props. */
  capabilities?: ComponentCapabilities
}

export interface ComponentInteraction {
  id: string
  label: string
  mutates: boolean
  target: 'view' | 'record' | 'assistant'
}

export interface ComponentCapabilities {
  support: 'interactive' | 'display-only'
  interactions: readonly ComponentInteraction[]
  binding?: {
    required: boolean
    fieldRefs?: 'id' | 'name' | 'id-or-name'
    expectations?: readonly string[]
  }
  limits?: Readonly<Record<string, string | number | boolean>>
}

const spanProp: PropSpec = {
  kind: 'number',
  label: 'Column span',
  min: 1,
  max: 12,
  default: 12,
  help: 'Width in a 12-column grid.'
}

const TONES = ['info', 'success', 'warning', 'danger', 'neutral'] as const

export const COMPONENTS: readonly ComponentSpec[] = [
  /* ----------------------------- layout ----------------------------- */
  {
    type: 'page',
    label: 'Page',
    icon: 'file-line',
    category: 'layout',
    accepts: 'any',
    bindable: false,
    summary: 'Root container for a View. Exactly one page per View.',
    props: {
      width: { kind: 'enum', label: 'Content width', values: ['narrow', 'default', 'wide', 'full'], default: 'default' },
      gap: { kind: 'number', label: 'Gap', min: 0, max: 48, default: 16 },
      padding: { kind: 'number', label: 'Padding', min: 0, max: 96, default: 40 },
      align: { kind: 'enum', label: 'Alignment', values: ['start', 'center'], default: 'center' }
    },
    aiHint: 'Always the root node. Keep at most one page node per View.',
    example: { width: 'default', gap: 16, padding: 40 }
  },
  {
    type: 'stack',
    label: 'Stack',
    icon: 'layout-line',
    category: 'layout',
    accepts: 'any',
    bindable: false,
    summary: 'Vertical stack of children.',
    props: {
      gap: { kind: 'number', label: 'Gap', min: 0, max: 48, default: 12 },
      dividers: { kind: 'boolean', label: 'Show dividers', default: false }
    },
    example: { gap: 12 }
  },
  {
    type: 'row',
    label: 'Row',
    icon: 'column-line',
    category: 'layout',
    accepts: 'any',
    bindable: false,
    summary: 'Horizontal row of children.',
    props: {
      gap: { kind: 'number', label: 'Gap', min: 0, max: 48, default: 12 },
      align: { kind: 'enum', label: 'Align', values: ['start', 'center', 'end', 'stretch'], default: 'stretch' },
      wrap: { kind: 'boolean', label: 'Wrap', default: true }
    },
    example: { gap: 12, align: 'stretch' }
  },
  {
    type: 'grid',
    label: 'Grid',
    icon: 'grid-line',
    category: 'layout',
    accepts: 'any',
    bindable: false,
    summary: 'Responsive 12-column grid. Children use `span`.',
    props: {
      gap: { kind: 'number', label: 'Gap', min: 0, max: 48, default: 16 },
      minColumn: { kind: 'number', label: 'Min column width (px)', min: 120, max: 480, default: 220 }
    },
    aiHint: 'Preferred layout for dashboards. Put metric/table/chart children in a grid and set spans.',
    example: { gap: 16, minColumn: 220 }
  },
  {
    type: 'columns',
    label: 'Columns',
    icon: 'column-line',
    category: 'layout',
    accepts: 'any',
    bindable: false,
    summary: 'Fixed side-by-side columns that collapse on narrow windows.',
    props: {
      count: { kind: 'number', label: 'Columns', min: 2, max: 4, default: 2 },
      gap: { kind: 'number', label: 'Gap', min: 0, max: 48, default: 16 }
    },
    example: { count: 2, gap: 16 }
  },
  {
    type: 'section',
    label: 'Section',
    icon: 'box-line',
    category: 'layout',
    accepts: 'any',
    bindable: false,
    summary: 'Titled card that groups content.',
    props: {
      title: { kind: 'string', label: 'Title', default: '' },
      subtitle: { kind: 'string', label: 'Subtitle', default: '' },
      icon: { kind: 'icon', label: 'Icon', default: '' },
      tone: { kind: 'enum', label: 'Tone', values: TONES, default: 'neutral' },
      collapsible: { kind: 'boolean', label: 'Collapsible', default: false },
      defaultOpen: { kind: 'boolean', label: 'Initially open', default: true },
      span: spanProp
    },
    aiHint: 'Use to give a redesign visible structure instead of a flat list of fields.',
    example: { title: 'Overview', icon: 'chart-line-line' }
  },
  {
    type: 'tabs',
    label: 'Tabs',
    icon: 'layout-grid-line',
    category: 'layout',
    accepts: ['section', 'stack', 'grid', 'columns', 'text', 'rich', 'table', 'list', 'metrics'],
    bindable: false,
    summary: 'Tabbed container. Each child is a tab.',
    props: {
      labels: { kind: 'stringList', label: 'Tab labels', default: [] },
      side: { kind: 'enum', label: 'Tab bar', values: ['top', 'left'], default: 'top' }
    },
    example: { labels: ['Overview', 'Details'] }
  },
  {
    type: 'divider',
    label: 'Divider',
    icon: 'border-horizontal-line',
    category: 'layout',
    accepts: null,
    bindable: false,
    summary: 'Horizontal rule.',
    props: {
      label: { kind: 'string', label: 'Label', default: '' }
    }
  },
  {
    type: 'spacer',
    label: 'Spacer',
    icon: 'transfer-vertical-line',
    category: 'layout',
    accepts: null,
    bindable: false,
    summary: 'Vertical space.',
    props: { size: { kind: 'number', label: 'Height', min: 4, max: 200, default: 24 } }
  },

  /* ---------------------------- content ----------------------------- */
  {
    type: 'heading',
    label: 'Heading',
    icon: 'heading-1-line',
    category: 'content',
    accepts: null,
    bindable: 'block',
    summary: 'A heading. Bound to a single rich-text block.',
    props: {
      level: { kind: 'number', label: 'Level', min: 1, max: 4, default: 1 },
      placeholder: { kind: 'string', label: 'Placeholder', default: 'Untitled' },
      span: spanProp
    },
    aiHint: 'Bind with { recordId, blockIds:[id] } to promote an existing heading block.',
    example: { level: 1 }
  },
  {
    type: 'text',
    label: 'Text',
    icon: 'text-line',
    category: 'content',
    accepts: null,
    bindable: 'block',
    summary: 'A paragraph of rich text. Bound to a single block.',
    props: {
      placeholder: { kind: 'string', label: 'Placeholder', default: 'Write something…' },
      size: { kind: 'enum', label: 'Size', values: ['sm', 'base', 'lg'], default: 'base' },
      muted: { kind: 'boolean', label: 'Muted', default: false },
      span: spanProp
    },
    example: { size: 'base' }
  },
  {
    type: 'rich',
    label: 'Document',
    icon: 'document-line',
    category: 'content',
    accepts: null,
    bindable: ['richtext'],
    summary: 'Full rich-text document bound to a record. The barebones editing surface.',
    props: {
      placeholder: { kind: 'string', label: 'Placeholder', default: 'Start writing…' },
      editable: { kind: 'boolean', label: 'Editable', default: true },
      showToolbar: { kind: 'boolean', label: 'Show toolbar', default: true },
      span: spanProp
    },
    aiHint: 'Keep exactly one rich node when converting a barebones page, so the user never loses their writing surface.',
    example: { editable: true }
  },
  {
    type: 'callout',
    label: 'Callout',
    icon: 'information-line',
    category: 'content',
    accepts: 'any',
    bindable: ['richtext', 'fields'],
    summary: 'Highlighted note.',
    props: {
      tone: { kind: 'enum', label: 'Tone', values: TONES, default: 'info' },
      title: { kind: 'string', label: 'Title', default: '' },
      icon: { kind: 'icon', label: 'Icon', default: '' },
      span: spanProp
    },
    example: { tone: 'info', title: 'Note' }
  },
  {
    type: 'quote',
    label: 'Quote',
    icon: 'quote-left-line',
    category: 'content',
    accepts: null,
    bindable: 'block',
    summary: 'Blockquote bound to a block.',
    props: {
      source: { kind: 'string', label: 'Attribution', default: '' },
      span: spanProp
    }
  },
  {
    type: 'code',
    label: 'Code',
    icon: 'code-line',
    category: 'content',
    accepts: null,
    bindable: 'block',
    summary: 'Code block bound to a block.',
    props: {
      language: { kind: 'string', label: 'Language', default: '' },
      span: spanProp
    }
  },
  {
    type: 'keyvalue',
    label: 'Key / value',
    icon: 'list-check-line',
    category: 'content',
    accepts: null,
    bindable: ['fields'],
    summary: 'Compact label/value list from a fields record.',
    props: {
      columns: { kind: 'number', label: 'Columns', min: 1, max: 4, default: 2 },
      span: spanProp
    },
    example: { columns: 2 }
  },

  /* ------------------------------ data ------------------------------ */
  {
    type: 'metric',
    label: 'Metric',
    icon: 'chart-line-line',
    category: 'data',
    accepts: null,
    bindable: ['metric'],
    summary: 'Single KPI tile.',
    props: {
      label: { kind: 'string', label: 'Label', default: 'Metric' },
      unit: { kind: 'string', label: 'Unit', default: '' },
      format: { kind: 'enum', label: 'Format', values: ['number', 'percent', 'currency'], default: 'number' },
      trend: { kind: 'enum', label: 'Trend', values: ['none', 'up', 'down'], default: 'none' },
      icon: { kind: 'icon', label: 'Icon', default: '' },
      tone: { kind: 'enum', label: 'Tone', values: TONES, default: 'neutral' },
      editable: { kind: 'boolean', label: 'Allow value editing', default: true },
      span: spanProp
    },
    aiHint: 'Give each metric its own record so numbers can be edited independently and keep their identity across redesigns.',
    example: { label: 'Revenue', format: 'currency', trend: 'up', span: 3 },
    capabilities: {
      support: 'interactive',
      interactions: [{ id: 'edit-value', label: 'Edit metric value', mutates: true, target: 'record' }],
      binding: { required: true, expectations: ['Bind one metric record.'] },
      limits: { seriesEditing: false, automaticAggregation: false }
    }
  },
  {
    type: 'metrics',
    label: 'Metric row',
    icon: 'dashboard-line',
    category: 'data',
    accepts: ['metric'],
    bindable: false,
    summary: 'Row of metric tiles.',
    props: {
      columns: { kind: 'number', label: 'Columns', min: 2, max: 4, default: 4 },
      span: spanProp
    },
    example: { columns: 4 }
  },
  {
    type: 'table',
    label: 'Table',
    icon: 'table-line',
    category: 'data',
    accepts: null,
    bindable: ['table'],
    summary: 'Data table with typed columns, inline editing and sorting.',
    props: {
      columns: { kind: 'stringList', label: 'Columns', default: [] },
      density: { kind: 'enum', label: 'Density', values: ['compact', 'cozy'], default: 'cozy' },
      striped: { kind: 'boolean', label: 'Striped', default: false },
      showFooter: { kind: 'boolean', label: 'Show totals', default: false },
      span: spanProp
    },
    aiHint: 'The right answer for "tracker", "list of X with fields" or anything with repeated rows. Create RecordKind "table".',
    example: { columns: ['Name', 'Status', 'Owner'], density: 'cozy' },
    capabilities: {
      support: 'interactive',
      interactions: [
        { id: 'create-row', label: 'Add row', mutates: true, target: 'record' },
        { id: 'edit-cell', label: 'Edit typed cell', mutates: true, target: 'record' },
        { id: 'delete-row', label: 'Delete row', mutates: true, target: 'record' },
        { id: 'duplicate-row', label: 'Duplicate row', mutates: true, target: 'record' },
        { id: 'archive-row', label: 'Archive row', mutates: true, target: 'record' },
        { id: 'undo', label: 'Undo latest record action', mutates: true, target: 'record' },
        { id: 'sort', label: 'Sort visible rows', mutates: false, target: 'view' },
        { id: 'search', label: 'Search rows', mutates: false, target: 'view' }
      ],
      binding: { required: true, fieldRefs: 'name', expectations: ['Bind one table record.', 'columns is an optional projection by column name.'] },
      limits: { schemaEditing: false, rowReordering: false, archivedRowsVisible: false }
    }
  },
  {
    type: 'kanban',
    label: 'Board',
    icon: 'grid-2-line',
    category: 'data',
    accepts: null,
    bindable: ['table'],
    summary: 'Kanban board grouping table rows by a status column.',
    props: {
      groupBy: { kind: 'string', label: 'Group by column', default: '' },
      titleField: { kind: 'string', label: 'Card title column', default: '' },
      editable: { kind: 'boolean', label: 'Allow board editing', default: true },
      showSearch: { kind: 'boolean', label: 'Show search', default: true },
      showCounts: { kind: 'boolean', label: 'Show lane counts', default: true },
      wipLimit: { kind: 'number', label: 'Lane work-in-progress warning', min: 0, max: 999, default: 0 },
      span: spanProp
    },
    aiHint: 'Bind a table and use stable column IDs for groupBy/titleField. groupBy must be a select column with explicit options to preserve ordered empty lanes. A companion table is useful for scanning all fields.',
    example: { groupBy: 'block_status', titleField: 'block_title' },
    capabilities: {
      support: 'interactive',
      interactions: [
        { id: 'create-row', label: 'Add card in a lane', mutates: true, target: 'record' },
        { id: 'edit-title', label: 'Edit card title', mutates: true, target: 'record' },
        { id: 'edit-details', label: 'Edit all card fields', mutates: true, target: 'record' },
        { id: 'change-group', label: 'Move card between lanes', mutates: true, target: 'record' },
        { id: 'reorder-card', label: 'Reorder card within a lane', mutates: true, target: 'record' },
        { id: 'duplicate-card', label: 'Duplicate card', mutates: true, target: 'record' },
        { id: 'archive-card', label: 'Archive card', mutates: true, target: 'record' },
        { id: 'create-lane', label: 'Create lane', mutates: true, target: 'record' },
        { id: 'rename-lane', label: 'Rename lane and its values', mutates: true, target: 'record' },
        { id: 'reorder-lane', label: 'Reorder lanes', mutates: true, target: 'record' },
        { id: 'remove-lane', label: 'Remove lane and reassign cards', mutates: true, target: 'record' },
        { id: 'undo', label: 'Undo latest record action', mutates: true, target: 'record' },
        { id: 'search', label: 'Search cards', mutates: false, target: 'view' }
      ],
      binding: {
        required: true,
        fieldRefs: 'id-or-name',
        expectations: ['Bind one table record.', 'groupBy should reference a select column ID.', 'titleField should reference a text column ID.']
      },
      limits: {
        groupIdentity: 'cell-value',
        emptyGroups: 'select-options-only',
        nonTitleCardFields: 'editable-in-details',
        dragDrop: true,
        deleteCard: 'details-dialog-only',
        rowOrdering: true,
        laneEditing: true,
        search: true,
        filters: 'one-field-contains',
        sorting: 'one-field-asc-desc',
        swimlanes: false,
        wipLimits: 'visual-warning'
      }
    }
  },
  {
    type: 'list',
    label: 'List',
    icon: 'list-ordered-line',
    category: 'data',
    accepts: null,
    bindable: ['list', 'table'],
    summary: 'Simple bulleted or numbered list from a record.',
    props: {
      ordered: { kind: 'boolean', label: 'Ordered', default: false },
      columns: { kind: 'number', label: 'Columns', min: 1, max: 3, default: 1 },
      span: spanProp
    }
  },
  {
    type: 'checklist',
    label: 'Checklist',
    icon: 'checkbox-line',
    category: 'data',
    accepts: null,
    bindable: ['list', 'richtext'],
    summary: 'Interactive checklist.',
    props: {
      showProgress: { kind: 'boolean', label: 'Show progress', default: true },
      span: spanProp
    }
  },
  {
    type: 'fields',
    label: 'Fields',
    icon: 'edit-line',
    category: 'data',
    accepts: null,
    bindable: ['fields'],
    summary: 'Purpose-built data-entry form for a fields record.',
    props: {
      layout: { kind: 'enum', label: 'Layout', values: ['stack', 'inline'], default: 'stack' },
      submitLabel: { kind: 'string', label: 'Submit label', default: '' },
      editable: { kind: 'boolean', label: 'Allow field editing', default: true },
      span: spanProp
    },
    aiHint: 'The right answer for "a form to capture X". Declare the schema on the fields record.',
    example: { layout: 'stack' },
    capabilities: {
      support: 'interactive',
      interactions: [
        { id: 'edit-field', label: 'Edit a focused field', mutates: true, target: 'record' },
        { id: 'submit-entry', label: 'Append a form entry', mutates: true, target: 'record' }
      ],
      binding: {
        required: true,
        fieldRefs: 'id-or-name',
        expectations: ['Bind one fields record.', 'No field or mode=list renders a repeatable submission form.', 'field with mode=value/editor renders one focused input.']
      },
      limits: { schemaEditing: false, entryDeletion: false }
    }
  },
  {
    type: 'progress',
    label: 'Progress',
    icon: 'donut-line',
    category: 'data',
    accepts: null,
    bindable: ['metric', 'table', 'list'],
    summary: 'Progress bar toward a target.',
    props: {
      label: { kind: 'string', label: 'Label', default: '' },
      target: { kind: 'number', label: 'Target', default: 100 },
      tone: { kind: 'enum', label: 'Tone', values: TONES, default: 'neutral' },
      span: spanProp
    }
  },
  {
    type: 'chart.bar',
    label: 'Bar chart',
    icon: 'chart-bar-line',
    category: 'data',
    accepts: null,
    bindable: ['table', 'metric'],
    summary: 'Bar chart from a table record (first column = label, second = value).',
    props: {
      title: { kind: 'string', label: 'Title', default: '' },
      labelField: { kind: 'string', label: 'Label column', default: '' },
      valueField: { kind: 'string', label: 'Value column', default: '' },
      stacked: { kind: 'boolean', label: 'Stacked', default: false },
      height: { kind: 'number', label: 'Height', min: 80, max: 480, default: 200 },
      span: spanProp
    },
    example: { height: 200, span: 6 },
    capabilities: {
      support: 'display-only', interactions: [],
      binding: { required: true, fieldRefs: 'id-or-name', expectations: ['Bind a table or metric record; table valueField should be numeric.'] },
      limits: { editSource: false, filters: false }
    }
  },
  {
    type: 'chart.line',
    label: 'Line chart',
    icon: 'chart-line-line',
    category: 'data',
    accepts: null,
    bindable: ['table', 'metric'],
    summary: 'Line chart from a table record.',
    props: {
      title: { kind: 'string', label: 'Title', default: '' },
      labelField: { kind: 'string', label: 'X column', default: '' },
      valueField: { kind: 'string', label: 'Y column', default: '' },
      area: { kind: 'boolean', label: 'Filled', default: true },
      height: { kind: 'number', label: 'Height', min: 80, max: 480, default: 200 },
      span: spanProp
    },
    example: { area: true, span: 6 },
    capabilities: {
      support: 'display-only', interactions: [],
      binding: { required: true, fieldRefs: 'id-or-name', expectations: ['Bind a table or metric record; table valueField should be numeric.'] },
      limits: { editSource: false, filters: false }
    }
  },
  {
    type: 'chart.donut',
    label: 'Donut',
    icon: 'chart-pie-line',
    category: 'data',
    accepts: null,
    bindable: ['table', 'metric'],
    summary: 'Donut chart from a table record.',
    props: {
      title: { kind: 'string', label: 'Title', default: '' },
      labelField: { kind: 'string', label: 'Label column', default: '' },
      valueField: { kind: 'string', label: 'Value column', default: '' },
      height: { kind: 'number', label: 'Height', min: 80, max: 480, default: 200 },
      span: spanProp
    },
    example: { span: 4 },
    capabilities: {
      support: 'display-only', interactions: [],
      binding: { required: true, fieldRefs: 'id-or-name', expectations: ['Bind a table or metric record; table valueField should be numeric.'] },
      limits: { editSource: false, filters: false }
    }
  },
  {
    type: 'timeline',
    label: 'Timeline',
    icon: 'time-line',
    category: 'data',
    accepts: null,
    bindable: ['table', 'list'],
    summary: 'Chronological timeline from a table record.',
    props: {
      dateField: { kind: 'string', label: 'Date column', default: '' },
      titleField: { kind: 'string', label: 'Title column', default: '' },
      span: spanProp
    },
    aiHint: 'Display-only chronology. Do not promise event creation, editing, dragging or scheduling.',
    capabilities: {
      support: 'display-only', interactions: [],
      binding: { required: true, fieldRefs: 'id-or-name', expectations: ['Bind a table or list record.'] },
      limits: { create: false, edit: false, dragDrop: false }
    }
  },
  {
    type: 'calendar',
    label: 'Calendar',
    icon: 'calendar-line',
    category: 'data',
    accepts: null,
    bindable: ['table'],
    summary: 'Month calendar from a table record with a date column.',
    props: {
      dateField: { kind: 'string', label: 'Date column', default: '' },
      titleField: { kind: 'string', label: 'Title column', default: '' },
      span: spanProp
    },
    aiHint: 'Display-only month view. Do not promise event creation, editing, dragging or scheduling.',
    capabilities: {
      support: 'display-only', interactions: [],
      binding: { required: true, fieldRefs: 'id-or-name', expectations: ['Bind a table record with a date column.'] },
      limits: { create: false, edit: false, dragDrop: false }
    }
  },
  {
    type: 'badge',
    label: 'Badge',
    icon: 'bookmark-line',
    category: 'data',
    accepts: null,
    bindable: 'block',
    summary: 'Small status chip.',
    props: {
      text: { kind: 'string', label: 'Text', default: 'Status' },
      tone: { kind: 'enum', label: 'Tone', values: TONES, default: 'neutral' },
      icon: { kind: 'icon', label: 'Icon', default: '' }
    }
  },
  {
    type: 'button',
    label: 'Button',
    icon: 'cursor-line',
    category: 'data',
    accepts: null,
    bindable: ['table'],
    summary: 'Action button that can trigger a chat prompt or add a row.',
    props: {
      label: { kind: 'string', label: 'Label', default: 'Action' },
      action: { kind: 'enum', label: 'Action', values: ['prompt', 'addRow', 'none'], default: 'prompt' },
      prompt: { kind: 'text', label: 'Prompt sent to the assistant', default: '' },
      targetRecordId: { kind: 'string', label: 'Target table record id', default: '' },
      editable: { kind: 'boolean', label: 'Enable action', default: true },
      variant: { kind: 'enum', label: 'Variant', values: ['primary', 'secondary', 'ghost'], default: 'secondary' },
      icon: { kind: 'icon', label: 'Icon', default: '' }
    },
    aiHint: 'For addRow, set targetRecordId to a stable table record ID or bind the button to that record. Prompt actions send the exact prompt to the assistant.',
    example: { label: 'Add task', action: 'addRow', targetRecordId: 'record_tasks' },
    capabilities: {
      support: 'interactive',
      interactions: [
        { id: 'prompt', label: 'Send a fixed assistant prompt', mutates: false, target: 'assistant' },
        { id: 'create-row', label: 'Add a row to a target table', mutates: true, target: 'record' }
      ],
      binding: { required: false, expectations: ['For addRow, use targetRecordId or bind a table record.'] },
      limits: { customCode: false, arbitraryActions: false }
    }
  },

  /* ------------------------------ media ----------------------------- */
  {
    type: 'image',
    label: 'Image',
    icon: 'photo-album-line',
    category: 'media',
    accepts: null,
    bindable: false,
    summary: 'Image by URL.',
    props: {
      src: { kind: 'string', label: 'Source', default: '' },
      alt: { kind: 'string', label: 'Alt text', default: '' },
      caption: { kind: 'string', label: 'Caption', default: '' },
      fit: { kind: 'enum', label: 'Fit', values: ['cover', 'contain'], default: 'cover' },
      height: { kind: 'number', label: 'Height', min: 60, max: 600, default: 180 },
      span: spanProp
    }
  },
  {
    type: 'gallery',
    label: 'Gallery',
    icon: 'album-line',
    category: 'media',
    accepts: null,
    bindable: ['table', 'list'],
    summary: 'Responsive image grid from a record.',
    props: {
      imageField: { kind: 'string', label: 'Image column', default: '' },
      captionField: { kind: 'string', label: 'Caption column', default: '' },
      columns: { kind: 'number', label: 'Columns', min: 2, max: 6, default: 3 },
      span: spanProp
    }
  },
  {
    type: 'embed',
    label: 'Embed',
    icon: 'link-line',
    category: 'media',
    accepts: null,
    bindable: false,
    summary: 'External URL card.',
    props: {
      url: { kind: 'string', label: 'URL', default: '' },
      title: { kind: 'string', label: 'Title', default: '' },
      description: { kind: 'string', label: 'Description', default: '' },
      span: spanProp
    }
  }
] as const

export const COMPONENT_MAP: Record<string, ComponentSpec> = Object.fromEntries(
  COMPONENTS.map((c) => [c.type, c])
)

export type ComponentType = (typeof COMPONENTS)[number]['type']

export const VALID_COMPONENT_TYPES: readonly string[] = COMPONENTS.map((c) => c.type)

export function getComponent(type: string): ComponentSpec | undefined {
  return COMPONENT_MAP[type]
}

export function isComponentType(type: unknown): type is string {
  return typeof type === 'string' && type in COMPONENT_MAP
}

/** Types that may be used as the View root. */
export const ROOT_TYPES = ['page'] as const

export function specProps(type: string): Record<string, PropSpec> {
  return getComponent(type)?.props ?? {}
}

/** Validate + coerce a props object against the registry. Unknown keys are dropped. */
export function sanitizeProps(
  type: string,
  props: Record<string, unknown> | undefined
): Record<string, unknown> {
  const spec = getComponent(type)
  if (!spec || !props) return {}
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(props)) {
    const def = spec.props[key]
    if (!def || raw === undefined || raw === null) continue
    switch (def.kind) {
      case 'string':
      case 'text':
        if (typeof raw === 'string') out[key] = raw
        break
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(num)) break
        const min = def.min ?? -Infinity
        const max = def.max ?? Infinity
        out[key] = Math.min(max, Math.max(min, num))
        break
      }
      case 'boolean':
        if (typeof raw === 'boolean') out[key] = raw
        else if (raw === 'true' || raw === 'false') out[key] = raw === 'true'
        break
      case 'enum':
        if (typeof raw === 'string' && (def.values ?? []).includes(raw)) out[key] = raw
        break
      case 'color':
      case 'icon':
        if (typeof raw === 'string') out[key] = raw
        break
      case 'stringList':
        if (Array.isArray(raw)) out[key] = raw.filter((v): v is string => typeof v === 'string')
        break
      case 'node':
        out[key] = raw
        break
      default:
        break
    }
  }
  return out
}

export function defaultProps(type: string): Record<string, unknown> {
  const spec = getComponent(type)
  if (!spec) return {}
  const out: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(spec.props)) {
    if (def.default !== undefined) out[key] = def.default
  }
  return out
}

/**
 * Compact registry description for the model prompt. Keep this terse — it is
 * injected into every View-architect turn.
 */
export function registryBrief(): string {
  return COMPONENTS.map((c) => {
    const props = Object.entries(c.props)
      .map(([k, v]) => {
        if (v.kind === 'enum') return `${k}:${(v.values ?? []).join('|')}`
        if (v.kind === 'boolean') return `${k}?`
        return `${k}:${v.kind}`
      })
      .join(', ')
    const bind = c.bindable === false ? 'no' : c.bindable === 'block' ? 'block' : c.bindable.join('|')
    const behavior = c.capabilities
      ? ` support=${c.capabilities.support} interactions=${c.capabilities.interactions.map((item) => item.id).join('|') || 'none'}${c.capabilities.binding?.fieldRefs ? ` fieldRefs=${c.capabilities.binding.fieldRefs}` : ''}${c.capabilities.limits ? ` limits=${JSON.stringify(c.capabilities.limits)}` : ''}`
      : ''
    return `${c.type} [${c.category}] bind=${bind} (${props})${behavior} — ${c.summary}${c.aiHint ? ` Guidance: ${c.aiHint}` : ''}`
  }).join('\n')
}

/** JSON-safe registry surface for tools, tests and external planners. */
export function registryCapabilities(): Array<{
  type: string
  bindable: ComponentSpec['bindable']
  props: Record<string, PropSpec>
  capabilities: ComponentCapabilities | null
}> {
  return COMPONENTS.map((component) => ({
    type: component.type,
    bindable: component.bindable,
    props: component.props,
    capabilities: component.capabilities ?? null
  }))
}
