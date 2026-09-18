import type { ContentRecord, TableColumn, ViewDoc, ViewNode } from './types'
import { COMPONENT_MAP, registryCapabilities } from './viewSchema'

export interface ViewRecipeSpec {
  id: 'tracker' | 'crm' | 'intake' | 'dashboard'
  intents: readonly string[]
  purpose: string
  components: readonly string[]
  records: readonly string[]
  interactions: readonly string[]
  constraints: readonly string[]
}

/** Reusable starter shapes. They describe supported behavior, not sample content. */
export const VIEW_RECIPES: readonly ViewRecipeSpec[] = [
  {
    id: 'tracker',
    intents: ['project tracker', 'task tracker', 'kanban', 'backlog', 'ticket board', 'issue board'],
    purpose: 'Track work through explicit stages with a board and a full row editor.',
    components: ['kanban', 'table'],
    records: ['table: title(text), status(select with explicit options), owner(text), due(date)'],
    interactions: ['create card/row', 'edit all card fields', 'change status', 'drag and reorder cards', 'manage lanes', 'duplicate/archive/delete in details', 'search and undo'],
    constraints: ['Use stable column IDs in kanban props.', 'Status must be select with options so empty lanes remain visible.', 'Text search, one-field contains filtering and one-field sorting are supported; swimlanes are not.']
  },
  {
    id: 'crm',
    intents: ['crm', 'sales pipeline', 'lead tracker', 'deal pipeline', 'contacts pipeline'],
    purpose: 'Track contacts or deals through explicit pipeline stages.',
    components: ['kanban', 'table'],
    records: ['table: contact(text), company(text), stage(select with explicit options), owner(text), next step(text)'],
    interactions: ['create deal/contact', 'edit all fields', 'change stage', 'drag and reorder cards', 'manage lanes', 'duplicate/archive/delete', 'search and undo'],
    constraints: ['Use stable column IDs in kanban props.', 'Stage must be select with options.', 'Text search, one-field contains filtering and one-field sorting are supported. Do not claim automatic rollups, email sync or swimlanes.']
  },
  {
    id: 'intake',
    intents: ['intake', 'form', 'capture', 'submission', 'survey'],
    purpose: 'Capture repeatable structured submissions.',
    components: ['fields'],
    records: ['fields with stable IDs and typed definitions'],
    interactions: ['edit current fields', 'submit entry'],
    constraints: ['Use mode=list or no field binding for repeatable submissions.', 'Do not promise schema editing or entry deletion in the form.']
  },
  {
    id: 'dashboard',
    intents: ['dashboard', 'metrics', 'kpi', 'report', 'analytics'],
    purpose: 'Show editable metric tiles and display-only charts backed by structured data.',
    components: ['metrics', 'metric', 'chart.line', 'chart.bar', 'chart.donut', 'table'],
    records: ['metric records', 'table with label and numeric value columns'],
    interactions: ['edit metric values', 'edit source table through a companion table'],
    constraints: ['Charts do not edit source data.', 'Do not claim automatic aggregation unless the stored records already contain it.', 'Do not substitute calendar or timeline controls.']
  }
] as const

export interface ViewInspectionIssue {
  severity: 'error' | 'warning'
  code: string
  nodeId: string
  message: string
}

export interface InspectedViewNode {
  nodeId: string
  type: string
  supportedInteractions: string[]
  support: 'interactive' | 'display-only' | 'static'
  binding: {
    status: 'not-applicable' | 'missing' | 'resolved' | 'missing-record' | 'incompatible'
    recordId?: string
    recordKind?: string
    field?: { requested: string; resolvedId?: string; resolvedName?: string }
    blockIds?: Array<{ requested: string; resolved: boolean }>
  }
  resolvedProps?: Record<string, { requested: string; resolvedId?: string; resolvedName?: string; type?: string }>
  limits?: Readonly<Record<string, string | number | boolean>>
}

export interface ViewInspection {
  valid: boolean
  summary: { nodes: number; boundNodes: number; errors: number; warnings: number }
  nodes: InspectedViewNode[]
  issues: ViewInspectionIssue[]
}

function resolveColumn(columns: TableColumn[], ref: unknown): TableColumn | undefined {
  if (typeof ref !== 'string' || !ref) return undefined
  return columns.find((column) => column.id === ref) ?? columns.find((column) => column.name === ref)
}

export function inspectView(view: ViewDoc, records: Record<string, ContentRecord>): ViewInspection {
  const nodes: InspectedViewNode[] = []
  const issues: ViewInspectionIssue[] = []
  let boundNodes = 0

  const issue = (severity: ViewInspectionIssue['severity'], code: string, node: ViewNode, message: string) => {
    issues.push({ severity, code, nodeId: node.id, message })
  }

  const walk = (node: ViewNode) => {
    const spec = COMPONENT_MAP[node.type]
    const capability = spec?.capabilities
    const inspected: InspectedViewNode = {
      nodeId: node.id,
      type: node.type,
      supportedInteractions: capability?.interactions.map((interaction) => interaction.id) ?? [],
      support: capability?.support ?? 'static',
      binding: { status: spec?.bindable === false ? 'not-applicable' : 'missing' },
      ...(capability?.limits ? { limits: capability.limits } : {})
    }

    if (!spec) {
      issue('error', 'unknown-component', node, `Unknown component type ${node.type}.`)
    } else if (node.bind) {
      boundNodes += 1
      const record = records[node.bind.recordId]
      inspected.binding.recordId = node.bind.recordId
      if (!record) {
        inspected.binding.status = 'missing-record'
        issue('error', 'missing-record', node, `Binding references missing record ${node.bind.recordId}.`)
      } else {
        inspected.binding.recordKind = record.kind
        const accepted = spec.bindable === 'block' ? record.kind === 'richtext' : Array.isArray(spec.bindable) && spec.bindable.includes(record.kind)
        inspected.binding.status = accepted ? 'resolved' : 'incompatible'
        if (!accepted) issue('error', 'incompatible-binding', node, `${node.type} cannot bind a ${record.kind} record.`)

        if (node.bind.blockIds?.length) {
          const ids = record.kind === 'richtext' ? new Set(record.doc.blocks.map((block) => block.id)) : new Set<string>()
          inspected.binding.blockIds = node.bind.blockIds.map((requested) => ({ requested, resolved: ids.has(requested) }))
          for (const block of inspected.binding.blockIds) {
            if (!block.resolved) issue('error', 'missing-block', node, `Binding references missing block ${block.requested}.`)
          }
        }

        if (node.bind.field) {
          const fields = record.kind === 'fields' ? record.fields : record.kind === 'table' ? record.columns : []
          const field = fields.find((candidate) => candidate.id === node.bind!.field) ?? fields.find((candidate) => candidate.name === node.bind!.field)
          inspected.binding.field = { requested: node.bind.field, ...(field ? { resolvedId: field.id, resolvedName: field.name } : {}) }
          if (!field) issue('error', 'missing-field', node, `Binding field ${node.bind.field} does not exist on ${record.id}.`)
        }

        if (record.kind === 'table') {
          const refProps = node.type === 'kanban'
            ? ['groupBy', 'titleField']
            : node.type.startsWith('chart.')
              ? ['labelField', 'valueField']
              : node.type === 'calendar'
                ? ['dateField', 'titleField']
                : node.type === 'timeline'
                  ? ['dateField', 'titleField']
                  : []
          const resolvedProps: NonNullable<InspectedViewNode['resolvedProps']> = {}
          if (node.type === 'table' && Array.isArray(node.props?.columns)) {
            for (const [index, requested] of node.props.columns.entries()) {
              if (typeof requested !== 'string') continue
              const column = record.columns.find((candidate) => candidate.name === requested)
              resolvedProps[`columns[${index}]`] = { requested, ...(column ? { resolvedId: column.id, resolvedName: column.name, type: column.type } : {}) }
              if (!column) issue('warning', 'table-projection-missing', node, `Table projection names missing column ${requested}; the renderer will fall back when none match.`)
            }
          }
          for (const prop of refProps) {
            const requested = node.props?.[prop]
            if (typeof requested !== 'string' || !requested) continue
            const column = resolveColumn(record.columns, requested)
            resolvedProps[prop] = { requested, ...(column ? { resolvedId: column.id, resolvedName: column.name, type: column.type } : {}) }
            if (!column) issue('error', 'missing-column', node, `${prop} references missing column ${requested}.`)
          }
          if (Object.keys(resolvedProps).length) inspected.resolvedProps = resolvedProps
          if (node.type === 'kanban') {
            const group = resolveColumn(record.columns, node.props?.groupBy)
            if (!group) issue('error', 'kanban-group-missing', node, 'Kanban needs a resolvable groupBy column.')
            else if (group.type !== 'select' || !group.options?.length) {
              issue('warning', 'kanban-groups-not-explicit', node, 'Kanban groupBy should be a select column with explicit options; empty lanes cannot otherwise remain visible.')
            }
            if (!resolveColumn(record.columns, node.props?.titleField)) issue('error', 'kanban-title-missing', node, 'Kanban needs a resolvable titleField column.')
          }
          if (node.type.startsWith('chart.')) {
            const value = resolveColumn(record.columns, node.props?.valueField)
            if (value && value.type !== 'number') issue('warning', 'chart-value-not-numeric', node, `Chart valueField ${value.name} is ${value.type}; use a number column for truthful numeric output.`)
          }
        }
      }
    } else if (capability?.binding?.required) {
      issue('error', 'binding-required', node, `${node.type} requires a content binding.`)
    }

    if (node.type === 'button' && node.props?.action === 'addRow') {
      const requested = typeof node.props.targetRecordId === 'string' ? node.props.targetRecordId : ''
      if (requested) {
        const target = records[requested]
        inspected.resolvedProps = { ...(inspected.resolvedProps ?? {}), targetRecordId: { requested, ...(target ? { resolvedId: target.id, resolvedName: target.label ?? target.id, type: target.kind } : {}) } }
        if (!target) issue('error', 'button-target-missing', node, `Button targetRecordId references missing record ${requested}.`)
        else if (target.kind !== 'table') issue('error', 'button-target-incompatible', node, 'addRow button target must be a table record.')
      }
    }

    nodes.push(inspected)
    for (const child of node.children ?? []) walk(child)
  }

  walk(view.root)
  const errors = issues.filter((item) => item.severity === 'error').length
  const warnings = issues.length - errors
  return { valid: errors === 0, summary: { nodes: nodes.length, boundNodes, errors, warnings }, nodes, issues }
}

export function capabilitiesForPrompt(): string {
  return JSON.stringify({ components: registryCapabilities(), recipes: VIEW_RECIPES }, null, 2)
}
