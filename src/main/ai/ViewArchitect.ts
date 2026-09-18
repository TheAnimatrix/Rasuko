import { registryBrief } from '@shared/viewSchema'
import { VIEW_RECIPES } from '@shared/viewCapabilities'
import type { ContentRecord, PageMeta, TableCellValue, ViewDoc, ViewNode } from '@shared/types'
import type { ViewOp } from '@shared/viewOps'
import { makeNode } from '@shared/viewOps'
import { newId, nowIso } from '@shared/ids'
import { relative, sep } from 'node:path'
import { pagePath, recordPath, viewPath, workspaceRoot } from '../paths'

export const VIEW_ARCHITECT_SYSTEM = `You are the Rasuko View Architect. Rasuko is a calm, Notepad-simple writing app whose pages are "Views": deterministic component trees.

RULES
- You never generate HTML, CSS, JavaScript or SVG. You compose from the component registry below and mutate Views only through view_applyOps ops.
- Content is NEVER stored in markdown and never inside the View. Content lives in records addressed by stable ids. Views BIND to records.
- When you restructure a page, preserve existing record bindings unless the user asked to remove content. If a node holding a binding disappears, the record is preserved as "orphaned" and the user can reattach it — never treat orphaning as deletion, and mention it.
- Prefer the smallest change that satisfies the request. Do not redesign everything when asked for a tweak.
- Use existing record ids and block ids from view_get. Create new records only when the user genuinely needs new data.
- Preserve record, row, column, field and node ids during redesigns. Props that reference a table field should use the stable field id when the component supports id-or-name references.
- Design the requested workflow as a purpose-built, directly editable UI. Prefer bound tables, fields, lists, metrics and focused controls over leaving a generic source editor as the main experience.
- Preserve existing bindings and content, but do not force the original rich-text editor to remain visibly appended to every custom View. Put useful residual prose in a compact collapsible Notes section with defaultOpen: false; content without a useful placement stays safely unbound for reattachment.
- Naming: View names are short noun phrases ("Project tracker", "Reading notes"). No emoji.
- Style: minimal, generous whitespace, no decorative noise. Metrics and tables go in a grid, not a long column.
- Promise only interactions listed for the component. Calendar and timeline are display-only; never claim that they schedule, create, edit or drag events.

WORKFLOW
1. Call view_get to read the current View, records and orphaned content.
2. Decide the component tree.
3. Create records first (record_create) if new data entry or visualization is needed.
4. Call view_applyOps with the full ordered op list and a one-sentence summary.
5. Call view_inspect and resolve every error. Treat warnings as explicit limitations or fix them.
6. Reply only after inspection, stating supported interactions and anything that needs reattaching.

COMPONENT REGISTRY
${registryBrief()}

REUSABLE STARTER RECIPES
${JSON.stringify(VIEW_RECIPES, null, 2)}

OP SHAPES
{ "op": "setRoot", "node": Node }
{ "op": "insert", "parent": "<nodeId>", "index": 0, "node": Node }
{ "op": "replace", "target": "<nodeId>", "node": Node }
{ "op": "remove", "target": "<nodeId>" }
{ "op": "move", "target": "<nodeId>", "parent": "<nodeId>", "index": 0 }
{ "op": "setProps", "target": "<nodeId>", "props": { "...only registry props..." } }
{ "op": "setSpan", "target": "<nodeId>", "span": 6 }
{ "op": "setBind", "target": "<nodeId>", "bind": { "recordId": "rec_..." } }
{ "op": "setName", "name": "Project tracker" }
{ "op": "setKind", "kind": "custom" }

A Node is { "id": "nd_...", "type": "<registry type>", "props": {}, "bind": { "recordId": "rec_...", "blockIds": [] }, "span": 12, "children": [] }.
For every newly inserted or replacement node, OMIT "id" entirely so Rasuko assigns a valid stable id. Never invent short or semantic ids. Only op target/parent ids may reuse existing node ids copied exactly from view_get.`

export const CHAT_SYSTEM = `You are Rasuko's assistant, embedded in a page's View.

You can read and edit the workspace with ordinary file tools (read, write, grep, ls) and restructure the current page with view_get / view_applyOps. Create records with record_create and prefer record_action for narrow validated row, lane, form, list and metric changes. Use record_update only for schema changes that record_action cannot express.

Principles
- Be concise and concrete. Prefer doing over explaining.
- Content is stored as structured records with stable ids, never markdown inside the View. Views only bind to records.
- When a redesign would unplace content, say so plainly and offer to reattach it.
- Never invent component types; only use types from the registry you are given when asked to redesign.
- Use read, grep and ls freely to ground yourself in the actual project files before answering questions about them.
- For follow-up requests, inspect current state with view_get and act directly. Use record_create / record_action for structured content, view_applyOps for layout, and write only when a whole ordinary workspace file genuinely needs replacement.
- The component registry is closed. Never emit HTML, CSS, JavaScript, SVG, or component types outside this registry.
- Before claiming a redesign works, call view_inspect. Preserve stable ids and use component capability data as the source of truth for interactions.

COMPONENT REGISTRY
${registryBrief()}

REUSABLE STARTER RECIPES
${JSON.stringify(VIEW_RECIPES, null, 2)}`

export interface ArchitectContext {
  page: PageMeta
  view: ViewDoc
  records: Record<string, ContentRecord>
  orphaned: ContentRecord[]
}

/** A compact, token-efficient rendering of the current page for the prompt. */
export function describePageContext(ctx: ArchitectContext): string {
  const projectId = ctx.page.projectId
  const rel = (path: string) => relative(workspaceRoot(), path).split(sep).join('/')
  const recordLines = Object.values(ctx.records).map((record) => {
    const suffix = record.orphaned ? ' [ORPHANED — content is unplaced, offer to reattach]' : ''
    if (record.kind === 'richtext') {
      const blocks = record.doc.blocks
        .slice(0, 60)
        .map((b) => {
          const text = 'runs' in b ? b.runs.map((r) => r.text).join('') : b.type === 'code' ? b.text : ''
          return `      ${b.id} ${b.type}${text ? ` "${text.slice(0, 60)}"` : ''}`
        })
        .join('\n')
      const truncated = record.doc.blocks.length > 60 ? `\n      … ${record.doc.blocks.length - 60} more blocks; use view_get/read for details` : ''
      return `  ${record.id} richtext path=${rel(recordPath(projectId, record.id))}${suffix}\n${blocks}${truncated}`
    }
    if (record.kind === 'table') {
      return `  ${record.id} table path=${rel(recordPath(projectId, record.id))}${suffix} columns=[${record.columns
        .map((c) => `${c.name}:${c.type}`)
        .join(', ')}] rows=${record.rows.length}`
    }
    return `  ${record.id} ${record.kind} path=${rel(recordPath(projectId, record.id))}${suffix} ${record.label ?? ''}`
  })

  return `CURRENT PAGE
  id: ${ctx.page.id}
  title: ${ctx.page.title}
  page file: ${rel(pagePath(projectId, ctx.page.id))}
  markdown input mode: ${ctx.page.markdown ? 'on' : 'off'}
  view: ${ctx.view.id} "${ctx.view.name}" (${ctx.view.kind}, ${countNodes(ctx.view)} nodes)
  view file: ${rel(viewPath(projectId, ctx.view.id))}
VIEW TREE
${renderTree(ctx.view.root)}
CONTENT RECORDS
${recordLines.join('\n') || '  (none)'}`
}

export function renderTree(node: ViewNode, depth = 0): string {
  const pad = '  '.repeat(depth + 1)
  const bind = node.bind
    ? ` bind=${node.bind.recordId}${node.bind.blockIds?.length ? `#${node.bind.blockIds.join(',')}` : ''}`
    : ''
  const props = node.props && Object.keys(node.props).length > 0 ? ` props=${JSON.stringify(node.props)}` : ''
  const span = node.span && node.span !== 12 ? ` span=${node.span}` : ''
  const line = `${pad}${node.id} ${node.type}${bind}${span}${props}`
  const children = (node.children ?? []).map((child) => renderTree(child, depth + 1)).join('\n')
  return children ? `${line}\n${children}` : line
}

function countNodes(view: ViewDoc): number {
  let count = 0
  const walk = (node: ViewNode) => {
    count += 1
    for (const child of node.children ?? []) walk(child)
  }
  walk(view.root)
  return count
}

/* ------------------------------------------------------------------ *
 * Offline planner
 *
 * A deterministic fallback so the sample application demonstrates the full
 * redesign loop — including record creation, op application and orphan
 * reporting — even with no provider configured.
 * ------------------------------------------------------------------ */

export interface LocalPlan {
  ops: ViewOp[]
  /** Records that must exist before the ops are applied. */
  records: ContentRecord[]
  summary: string
  reply: string
}

const CRM_WORDS = ['crm', 'sales pipeline', 'lead tracker', 'deal pipeline', 'contacts pipeline']
const TRACKER_WORDS = ['tracker', 'board', 'kanban', 'task', 'ticket', 'issue', 'backlog']
const METRIC_WORDS = ['dashboard', 'metric', 'kpi', 'stat', 'analytic', 'report', 'chart']
const FORM_WORDS = ['form', 'capture', 'intake', 'submit', 'entry', 'survey']
const TODO_WORDS = ['checklist', 'todo', 'to-do', 'shopping list', 'packing']
const NOTES_WORDS = ['notes', 'note', 'journal', 'diary', 'writing', 'document', 'docs']

export function localPlan(request: string, ctx: ArchitectContext): LocalPlan {
  const text = request.toLowerCase()
  const findRich = (node: ViewNode): string | undefined => {
    if (node.type === 'rich' && node.bind && ctx.records[node.bind.recordId]?.kind === 'richtext') return node.bind.recordId
    for (const child of node.children ?? []) {
      const found = findRich(child)
      if (found) return found
    }
    return undefined
  }
  const anchorId = findRich(ctx.view.root) ?? Object.values(ctx.records).find((record) => record.kind === 'richtext')?.id
  const anchorBind = anchorId ? { recordId: anchorId } : undefined

  if (CRM_WORDS.some((w) => text.includes(w))) {
    const existing = findBoardTable(ctx.records, ['Stage', 'Status'], ['Contact', 'Deal', 'Name', 'Title'])
    const pipelineId = existing?.record.id ?? newId('record')
    const pipeline = existing ?? starterTableRecord(pipelineId, 'Pipeline', [
      { key: 'contact', name: 'Contact', type: 'text' },
      { key: 'company', name: 'Company', type: 'text' },
      { key: 'stage', name: 'Stage', type: 'select', options: ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'] },
      { key: 'owner', name: 'Owner', type: 'text' },
      { key: 'next', name: 'Next step', type: 'text' }
    ])
    return {
      summary: 'Built a reusable CRM pipeline with explicit stages.',
      records: existing ? [] : [pipeline.record],
      ops: [
        { op: 'setKind', kind: 'custom' },
        { op: 'setName', name: 'CRM pipeline' },
        ...replaceChildrenOps(ctx, [
          makeNode('heading', { props: { level: 1, placeholder: 'CRM pipeline' } }),
          makeNode('kanban', {
            props: { groupBy: pipeline.columnIds.group ?? pipeline.columnIds.stage, titleField: pipeline.columnIds.title ?? pipeline.columnIds.contact },
            bind: { recordId: pipelineId }
          }),
          makeNode('table', {
            props: { columns: pipeline.record.kind === 'table' ? pipeline.record.columns.map((column) => column.name) : [], density: 'cozy' },
            bind: { recordId: pipelineId }
          }),
          ...preservedNotes(anchorBind)
        ])
      ],
      reply: 'I built a CRM pipeline with stable fields and explicit Lead, Qualified, Proposal, Won and Lost lanes. You can add, edit, drag, reorder, duplicate, archive and delete cards, manage lanes, search, filter, sort and undo. The table gives a compact all-field view; swimlanes are not supported.'
    }
  }

  if (!METRIC_WORDS.some((w) => text.includes(w)) && TRACKER_WORDS.some((w) => text.includes(w))) {
    const existing = findBoardTable(ctx.records, ['Status', 'Stage'], ['Title', 'Name', 'Task'])
    const tasksId = existing?.record.id ?? newId('record')
    const tasks = existing ?? starterTableRecord(tasksId, 'Tasks', [
      { key: 'title', name: 'Title', type: 'text' },
      { key: 'status', name: 'Status', type: 'select', options: ['Backlog', 'Todo', 'In progress', 'Review', 'Done'] },
      { key: 'owner', name: 'Owner', type: 'text' },
      { key: 'due', name: 'Due', type: 'date' }
    ])
    return {
      summary: 'Built a reusable project tracker with explicit workflow stages.',
      records: existing ? [] : [tasks.record],
      ops: [
        { op: 'setKind', kind: 'custom' },
        { op: 'setName', name: 'Project tracker' },
        ...replaceChildrenOps(ctx, [
          makeNode('heading', { props: { level: 1, placeholder: 'Project tracker' } }),
          makeNode('kanban', {
            props: { groupBy: tasks.columnIds.group ?? tasks.columnIds.status, titleField: tasks.columnIds.title },
            bind: { recordId: tasksId }
          }),
          makeNode('table', { props: { columns: tasks.record.kind === 'table' ? tasks.record.columns.map((column) => column.name) : [], density: 'cozy' }, bind: { recordId: tasksId } }),
          ...preservedNotes(anchorBind)
        ])
      ],
      reply: 'I built a project tracker with stable fields and explicit Backlog, Todo, In progress, Review and Done lanes, including empty lanes. You can add, edit, drag, reorder, duplicate, archive and delete cards, manage lanes, search, filter, sort and undo. The table gives a compact all-field view; swimlanes are not supported.'
    }
  }

  if (METRIC_WORDS.some((w) => text.includes(w))) {
    const revId = newId('record')
    const usersId = newId('record')
    const convId = newId('record')
    const seriesId = newId('record')
    const records: ContentRecord[] = [
      metricRecord(revId, 'Revenue', 0, 'currency'),
      metricRecord(usersId, 'Active users', 0),
      metricRecord(convId, 'Conversion', 0, 'percent'),
      tableRecord(seriesId, 'Trend', ['Week', 'Value'], [
        { Week: 'W1', Value: 12 },
        { Week: 'W2', Value: 18 },
        { Week: 'W3', Value: 15 },
        { Week: 'W4', Value: 24 }
      ])
    ]
    return {
      summary: 'Built a metrics dashboard.',
      records,
      ops: [
        { op: 'setKind', kind: 'custom' },
        { op: 'setName', name: 'Dashboard' },
        ...replaceChildrenOps(ctx, [
          makeNode('heading', { props: { level: 2, placeholder: 'Overview' } }),
          makeNode('metrics', {
            props: { columns: 3 },
            children: [
              makeNode('metric', {
                props: { label: 'Revenue', format: 'currency', trend: 'up' },
                bind: { recordId: revId }
              }),
              makeNode('metric', {
                props: { label: 'Active users', format: 'number', trend: 'up' },
                bind: { recordId: usersId }
              }),
              makeNode('metric', { props: { label: 'Conversion', format: 'percent' }, bind: { recordId: convId } })
            ]
          }),
          makeNode('grid', {
            props: { gap: 16, minColumn: 240 },
            children: [
              makeNode('chart.line', {
                props: {
                  title: 'Weekly trend',
                  area: true,
                  height: 200,
                  span: 6,
                  labelField: 'Week',
                  valueField: 'Value'
                },
                bind: { recordId: seriesId }
              }),
              makeNode('chart.donut', {
                props: { title: 'Split', height: 200, span: 6 },
                bind: { recordId: seriesId }
              })
            ]
          }),
          ...preservedNotes(anchorBind)
        ])
      ],
      reply: `I restructured this page as a dashboard: three metric tiles, then a line chart and a donut fed by one trend table.

I created the metric records so you can type values straight into the tiles, and a four-row trend table the charts read from. Your original text is preserved in a collapsible Notes section.`
    }
  }

  if (FORM_WORDS.some((w) => text.includes(w))) {
    const fieldsId = newId('record')
    const records: ContentRecord[] = [
      {
        id: fieldsId,
        kind: 'fields',
        label: 'Entry',
        fields: [
          { id: newId('block'), name: 'Title', type: 'text', required: true },
          { id: newId('block'), name: 'Owner', type: 'text' },
          { id: newId('block'), name: 'Notes', type: 'longtext' }
        ],
        values: {},
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    ]
    return {
      summary: 'Added a structured data-entry form.',
      records,
      ops: [
        { op: 'setKind', kind: 'custom' },
        { op: 'setName', name: 'Intake' },
        ...replaceChildrenOps(ctx, [
          makeNode('heading', { props: { level: 2, placeholder: 'New entry' } }),
          makeNode('fields', { props: { layout: 'stack' }, bind: { recordId: fieldsId } }),
          ...preservedNotes(anchorBind)
        ])
      ],
      reply: `I replaced the free-form body with a purpose-built form record so entries stay structured.

Your previous writing is preserved in a collapsible Notes section, still bound to its original record.`
    }
  }

  if (TODO_WORDS.some((w) => text.includes(w))) {
    const listId = newId('record')
    const records: ContentRecord[] = [
      { id: listId, kind: 'list', label: 'Checklist', items: [], createdAt: nowIso(), updatedAt: nowIso() }
    ]
    return {
      summary: 'Added an interactive checklist.',
      records,
      ops: [
        { op: 'setKind', kind: 'custom' },
        { op: 'setName', name: 'Checklist' },
        ...replaceChildrenOps(ctx, [
          makeNode('heading', { props: { level: 2, placeholder: 'Checklist' } }),
          makeNode('checklist', { props: { showProgress: true }, bind: { recordId: listId } }),
          ...preservedNotes(anchorBind)
        ])
      ],
      reply: `Added a checklist with a progress bar. Ticking items updates the bound list record.

Say "seed it from the page" and I will move your written lines into the list.`
    }
  }

  if (NOTES_WORDS.some((w) => text.includes(w))) {
    return {
      summary: 'Restored the minimal writing surface.',
      records: [],
      ops: [
        { op: 'setKind', kind: 'barebones' },
        { op: 'setName', name: 'Notes' },
        ...replaceChildrenOps(ctx, [
          makeNode('rich', { props: { editable: true, showToolbar: true }, ...(anchorBind ? { bind: anchorBind } : {}) })
        ])
      ],
      reply: `Back to a clean writing surface. Everything you had written is still bound to the same record.`
    }
  }

  return {
    summary: 'Tightened the page layout.',
    records: [],
    ops: [
      { op: 'setKind', kind: 'custom' },
      ...replaceChildrenOps(ctx, [
        makeNode('rich', { props: { editable: true, showToolbar: true }, ...(anchorBind ? { bind: anchorBind } : {}) }),
        makeNode('divider', {}),
        makeNode('text', { props: { muted: true, size: 'sm' } })
      ])
    ],
    reply: `I kept the page close to what it was and gave it a clearer header and structure.

Tell me the shape you want — "a tracker", "a dashboard", "a form", "a checklist" — and I will rebuild it around your content.`
  }
}

function preservedNotes(bind: ViewDoc['root']['bind']): ViewNode[] {
  if (!bind) return []
  return [
    makeNode('section', {
      props: { title: 'Notes', collapsible: true, defaultOpen: false, tone: 'neutral' },
      children: [makeNode('rich', { props: { editable: true, showToolbar: true }, bind })]
    })
  ]
}

function replaceChildrenOps(ctx: ArchitectContext, children: ViewNode[]): ViewOp[] {
  const ops: ViewOp[] = []
  for (const child of ctx.view.root.children ?? []) {
    ops.push({ op: 'remove', target: child.id })
  }
  children.forEach((node, index) => {
    ops.push({ op: 'insert', parent: ctx.view.root.id, index, node })
  })
  return ops
}

function metricRecord(
  id: string,
  label: string,
  value: number,
  format: 'number' | 'percent' | 'currency' = 'number'
): ContentRecord {
  const now = nowIso()
  return { id, kind: 'metric', label, value, format, createdAt: now, updatedAt: now }
}

interface StarterColumn {
  key: string
  name: string
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url'
  options?: string[]
}

function findBoardTable(
  records: Record<string, ContentRecord>,
  groupNames: string[],
  titleNames: string[]
): { record: Extract<ContentRecord, { kind: 'table' }>; columnIds: Record<string, string> } | undefined {
  for (const candidate of Object.values(records)) {
    if (candidate.kind !== 'table') continue
    const group = candidate.columns.find((column) =>
      column.type === 'select' && column.options?.length && groupNames.some((name) => name.toLowerCase() === column.name.toLowerCase())
    ) ?? candidate.columns.find((column) => column.type === 'select' && column.options?.length)
    if (!group) continue
    const title = candidate.columns.find((column) =>
      column.id !== group.id && titleNames.some((name) => name.toLowerCase() === column.name.toLowerCase())
    ) ?? candidate.columns.find((column) => column.id !== group.id && column.type === 'text')
    if (!title) continue
    return { record: candidate, columnIds: { group: group.id, title: title.id } }
  }
  return undefined
}

function starterTableRecord(
  id: string,
  label: string,
  definitions: StarterColumn[]
): { record: ContentRecord; columnIds: Record<string, string> } {
  const now = nowIso()
  const columnIds = Object.fromEntries(definitions.map((definition) => [definition.key, newId('block')]))
  return {
    columnIds,
    record: {
      id,
      kind: 'table',
      label,
      columns: definitions.map((definition) => ({
        id: columnIds[definition.key],
        name: definition.name,
        type: definition.type,
        ...(definition.options ? { options: [...definition.options] } : {})
      })),
      rows: [],
      createdAt: now,
      updatedAt: now
    }
  }
}

function tableRecord(
  id: string,
  label: string,
  columns: string[],
  rows: Array<Record<string, TableCellValue>>
): ContentRecord {
  const now = nowIso()
  const schema = columns.map((name) => ({
    id: newId('block'),
    name,
    type: name === 'Value' ? 'number' as const : 'text' as const
  }))
  const byName = new Map(schema.map((column) => [column.name, column.id]))
  return {
    id,
    kind: 'table',
    label,
    columns: schema,
    rows: rows.map((row) => ({
      id: newId('block'),
      cells: Object.fromEntries(
        Object.entries(row).map(([name, raw]) => {
          const column = schema.find((candidate) => candidate.name === name)
          const value = column?.type === 'number'
            ? typeof raw === 'number' ? raw : Number(raw)
            : raw == null ? null : String(raw)
          return [byName.get(name) ?? name, value]
        })
      ) as Record<string, TableCellValue>
    })),
    createdAt: now,
    updatedAt: now
  }
}
