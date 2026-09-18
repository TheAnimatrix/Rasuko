import { existsSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { Type, type TSchema } from '@earendil-works/pi-ai'
import type { WorkspaceStore } from '../workspace/WorkspaceStore'
import { workspaceRoot, settingsPath } from '../paths'
import { atomicWriteFileSync, readTextSync } from '../io/atomic'
import { isId, newId, nowIso } from '@shared/ids'
import { normalizeDoc } from '@shared/richtext'
import { inspectView } from '@shared/viewCapabilities'
import { registryCapabilities } from '@shared/viewSchema'
import { RecordActionService } from '../workspace/RecordActionService'

export interface ToolContext {
  workspace: WorkspaceStore
  pageId: string | null
  projectId: string | null
  /** Called when a view mutation produced a receipt. */
  onViewOps?: (receipt: import('@shared/types').OpReceipt) => void
}

export interface ToolResult {
  content: string
  isError?: boolean
  details?: Record<string, unknown>
}

export interface ToolDef {
  name: string
  description: string
  parameters: TSchema
  /** Mutating tools are not offered in read-only modes. */
  mutates?: boolean
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

const MAX_READ_BYTES = 512 * 1024
const MAX_RESULTS = 200
const MAX_CONTEXT_ROWS = 20
const MAX_CONTEXT_ITEMS = 40
const MAX_CONTEXT_COLUMNS = 40

function guardPath(input: string): { ok: true; abs: string } | { ok: false; reason: string } {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, reason: 'path is required' }
  }
  const roots = [workspaceRoot()]
  const raw = input.trim()
  const abs = isAbsolute(raw) ? normalize(raw) : resolve(workspaceRoot(), raw)
  const allowed = roots.some((root) => abs === root || abs.startsWith(root + sep))
  if (!allowed) {
    return { ok: false, reason: `path escapes the workspace: ${raw}` }
  }
  return { ok: true, abs }
}

function relPath(abs: string): string {
  const rel = relative(workspaceRoot(), abs)
  return rel.split(sep).join('/')
}

function walkFiles(root: string, out: string[] = [], limit = 4000): string[] {
  if (out.length >= limit || !existsSync(root)) return out
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= limit) break
    const full = join(root, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) walkFiles(full, out, limit)
    else out.push(full)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * File tools — the assistant works on ordinary files, no MCP
 * ------------------------------------------------------------------ */

const readTool: ToolDef = {
  name: 'read',
  description:
    'Read a workspace file by path (relative to the workspace root). Returns raw file text. Use this to inspect views, pages and records before editing.',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path, e.g. projects/prj_x/views/vw_y.view.json' }),
    offset: Type.Optional(Type.Number({ description: '1-based first line to return' })),
    limit: Type.Optional(Type.Number({ description: 'Maximum lines to return' }))
  }),
  async execute(input) {
    const guarded = guardPath(String(input.path ?? ''))
    if (!guarded.ok) return { content: guarded.reason, isError: true }
    const text = readTextSync(guarded.abs)
    if (text === null) return { content: `File not found: ${relPath(guarded.abs)}`, isError: true }
    if (text.length > MAX_READ_BYTES) {
      return { content: `File too large (${text.length} bytes). Use grep to narrow down.`, isError: true }
    }
    const lines = text.split('\n')
    const offset = Math.max(1, Number(input.offset ?? 1))
    const limit = Number.isFinite(Number(input.limit)) ? Math.max(1, Number(input.limit)) : lines.length
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    return {
      content: slice.map((line, i) => `${offset + i}: ${line}`).join('\n'),
      details: { path: relPath(guarded.abs), lines: lines.length }
    }
  }
}

const writeTool: ToolDef = {
  name: 'write',
  description:
    'Write a workspace file. For views prefer view_applyOps so changes stay validated against the component registry. Use write for content records, page metadata or bulk edits.',
  mutates: true,
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path' }),
    content: Type.String({ description: 'Full file content to write' })
  }),
  async execute(input, ctx) {
    const guarded = guardPath(String(input.path ?? ''))
    if (!guarded.ok) return { content: guarded.reason, isError: true }
    const content = String(input.content ?? '')
    if (guarded.abs === settingsPath()) {
      return { content: 'Refusing to write settings through the file tools. Use the settings API.', isError: true }
    }
    const relativePath = relPath(guarded.abs)
    const managed = ctx.workspace.writeManagedFile(relativePath, content, ctx.pageId)
    if (managed) return managed
    try {
      atomicWriteFileSync(guarded.abs, content, { mode: 0o600 })
    } catch (error) {
      return { content: `Write failed: ${error instanceof Error ? error.message : 'unknown'}`, isError: true }
    }
    return { content: `Wrote ${relativePath} (${content.length} bytes)`, details: { path: relativePath } }
  }
}

const grepTool: ToolDef = {
  name: 'grep',
  description:
    'Search workspace file contents with a regular expression. Returns matching lines with file:line prefixes. Prefer this over reading whole files when looking for record ids, labels or text.',
  parameters: Type.Object({
    pattern: Type.String({ description: 'JavaScript regular expression' }),
    glob: Type.Optional(Type.String({ description: 'Only search paths containing this substring, e.g. records/' })),
    ignoreCase: Type.Optional(Type.Boolean()),
    maxResults: Type.Optional(Type.Number())
  }),
  async execute(input) {
    const pattern = String(input.pattern ?? '')
    if (!pattern) return { content: 'pattern is required', isError: true }
    const filter = typeof input.glob === 'string' && input.glob ? input.glob : null
    const limit = Math.min(MAX_RESULTS, Number(input.maxResults ?? 60) || 60)
    let regex: RegExp
    try {
      regex = new RegExp(pattern, input.ignoreCase ? 'i' : '')
    } catch (error) {
      return { content: `Invalid regex: ${error instanceof Error ? error.message : ''}`, isError: true }
    }
    const files = walkFiles(workspaceRoot()).filter((f) => !filter || relPath(f).includes(filter))
    const hits: string[] = []
    for (const file of files) {
      if (hits.length >= limit) break
      const text = readTextSync(file)
      if (text === null) continue
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (hits.length >= limit) break
        if (regex.test(lines[i])) {
          const line = lines[i].length > 240 ? `${lines[i].slice(0, 240)}…` : lines[i]
          hits.push(`${relPath(file)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    return {
      content: hits.length > 0 ? hits.join('\n') : 'No matches.',
      details: { matches: hits.length, filesScanned: files.length }
    }
  }
}

const lsTool: ToolDef = {
  name: 'ls',
  description: 'List workspace entries at a path. Directories are suffixed with a slash.',
  parameters: Type.Object({
    path: Type.Optional(Type.String({ description: 'Workspace-relative directory. Defaults to the workspace root.' }))
  }),
  async execute(input) {
    const guarded = guardPath(typeof input.path === 'string' && input.path ? input.path : '.')
    if (!guarded.ok) return { content: guarded.reason, isError: true }
    if (!existsSync(guarded.abs)) return { content: `Not found: ${relPath(guarded.abs)}`, isError: true }
    let entries: string[]
    try {
      entries = readdirSync(guarded.abs)
    } catch (error) {
      return { content: `Cannot list: ${error instanceof Error ? error.message : ''}`, isError: true }
    }
    const lines = entries.map((entry) => {
      try {
        return statSync(join(guarded.abs, entry)).isDirectory() ? `${entry}/` : entry
      } catch {
        return entry
      }
    })
    return { content: lines.length > 0 ? lines.join('\n') : '(empty)', details: { path: relPath(guarded.abs) } }
  }
}

/* ------------------------------------------------------------------ *
 * Workspace-aware tools
 * ------------------------------------------------------------------ */

const viewGetTool: ToolDef = {
  name: 'view_get',
  description:
    'Return the current page: its View tree (with node ids), its records with stable ids and block ids, and any orphaned records awaiting reattachment. Always call this before proposing view ops.',
  parameters: Type.Object({}),
  async execute(_input, ctx) {
    if (!ctx.pageId || !ctx.projectId) return { content: 'No page is open.', isError: true }
    const payload = ctx.workspace.pagePayload(ctx.pageId)
    if (!payload) return { content: 'Page not found.', isError: true }
    const inspection = inspectView(payload.view, payload.records)
    const recordIndex = Object.values(payload.records).map((record) => {
      const base = {
        id: record.id,
        kind: record.kind,
        label: record.label,
        orphaned: Boolean(record.orphaned),
        path: ctx.workspace.workspaceRelativeRecordPath(payload.page.projectId, record.id)
      }
      if (record.kind === 'richtext') {
        return {
          ...base,
          blocks: record.doc.blocks.slice(0, MAX_CONTEXT_ITEMS).map((b) => ({
            id: b.id,
            type: b.type,
            text: ('runs' in b ? b.runs.map((r) => r.text).join('') : b.type === 'code' ? b.text : '').slice(0, 240)
          })),
          truncatedBlocks: Math.max(0, record.doc.blocks.length - MAX_CONTEXT_ITEMS)
        }
      }
      if (record.kind === 'table') {
        const columns = record.columns.slice(0, MAX_CONTEXT_COLUMNS)
        const columnIds = new Set(columns.map((column) => column.id))
        return {
          ...base,
          columns: columns.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options })),
          rows: record.rows.slice(0, MAX_CONTEXT_ROWS).map((row) => ({
            id: row.id,
            cells: Object.fromEntries(Object.entries(row.cells).filter(([id]) => columnIds.has(id)))
          })),
          columnCount: record.columns.length,
          truncatedColumns: Math.max(0, record.columns.length - MAX_CONTEXT_COLUMNS),
          rowCount: record.rows.length,
          truncatedRows: Math.max(0, record.rows.length - MAX_CONTEXT_ROWS)
        }
      }
      if (record.kind === 'fields') {
        const fields = record.fields.slice(0, MAX_CONTEXT_COLUMNS)
        const fieldIds = new Set(fields.map((field) => field.id))
        const limitedValues = (values: Record<string, import('@shared/types').TableCellValue>) =>
          Object.fromEntries(Object.entries(values).filter(([id]) => fieldIds.has(id)))
        return {
          ...base,
          fields,
          values: limitedValues(record.values),
          entries: (record.entries ?? []).slice(-MAX_CONTEXT_ROWS).map((entry) => ({ ...entry, values: limitedValues(entry.values) })),
          fieldCount: record.fields.length,
          truncatedFields: Math.max(0, record.fields.length - MAX_CONTEXT_COLUMNS),
          entryCount: record.entries?.length ?? 0
        }
      }
      if (record.kind === 'list') {
        return {
          ...base,
          ordered: record.ordered,
          items: record.items.slice(0, MAX_CONTEXT_ITEMS),
          itemCount: record.items.length,
          truncatedItems: Math.max(0, record.items.length - MAX_CONTEXT_ITEMS)
        }
      }
      return { ...base, value: record.value, previous: record.previous, unit: record.unit, format: record.format, target: record.target, series: record.series?.slice(0, MAX_CONTEXT_ITEMS) }
    })
    return {
      content: JSON.stringify(
        {
          page: {
            id: payload.page.id,
            title: payload.page.title,
            markdown: payload.page.markdown,
            path: ctx.workspace.workspaceRelativePagePath(payload.page.projectId, payload.page.id)
          },
          view: {
            ...payload.view,
            path: ctx.workspace.workspaceRelativeViewPath(payload.page.projectId, payload.view.id)
          },
          records: recordIndex,
          orphaned: payload.orphaned.map((r) => ({ id: r.id, kind: r.kind, label: r.label })),
          diagnostics: inspection
        },
        null,
        2
      )
    }
  }
}

const viewInspectTool: ToolDef = {
  name: 'view_inspect',
  description: 'Validate the current View against real records and runtime component capabilities. Call after edits and resolve errors before claiming success. Reports resolved field bindings, supported interactions and known limits.',
  parameters: Type.Object({
    includeCapabilities: Type.Optional(Type.Boolean({ description: 'Include the full machine-readable component capability registry.' }))
  }),
  async execute(input, ctx) {
    if (!ctx.pageId) return { content: 'No page is open.', isError: true }
    const payload = ctx.workspace.pagePayload(ctx.pageId)
    if (!payload) return { content: 'Page not found.', isError: true }
    const inspection = inspectView(payload.view, payload.records)
    const body = {
      ...inspection,
      ...(input.includeCapabilities ? { componentCapabilities: registryCapabilities() } : {})
    }
    return {
      content: JSON.stringify(body, null, 2),
      isError: !inspection.valid,
      details: { inspection }
    }
  }
}

const viewApplyOpsTool: ToolDef = {
  name: 'view_applyOps',
  description:
    'Apply deterministic View operations. This is the ONLY way to restructure a page. Ops are validated against the component registry; invalid ops are skipped and reported. Never invent component types.',
  mutates: true,
  parameters: Type.Object({
    ops: Type.Array(
      Type.Object({
        op: Type.String({
          description: 'setRoot | insert | replace | remove | move | setProps | setSpan | setBind | setName | setKind'
        }),
        target: Type.Optional(Type.String()),
        parent: Type.Optional(Type.String()),
        index: Type.Optional(Type.Number()),
        node: Type.Optional(Type.Any()),
        props: Type.Optional(Type.Any()),
        span: Type.Optional(Type.Number()),
        bind: Type.Optional(Type.Any()),
        name: Type.Optional(Type.String()),
        kind: Type.Optional(Type.String())
      })
    ),
    summary: Type.Optional(Type.String({ description: 'One sentence describing the redesign for the user.' }))
  }),
  async execute(input, ctx) {
    if (!ctx.projectId) return { content: 'No project is open.', isError: true }
    const payload = ctx.pageId ? ctx.workspace.pagePayload(ctx.pageId) : null
    if (!payload) return { content: 'No page is open.', isError: true }
    const ops = Array.isArray(input.ops) ? (input.ops as import('@shared/viewOps').ViewOp[]) : []
    if (ops.length === 0) return { content: 'No ops supplied.', isError: true }
    const result = ctx.workspace.applyViewOps(
      ctx.projectId,
      payload.view.id,
      ops,
      typeof input.summary === 'string' ? input.summary : undefined
    )
    if (!result) return { content: 'View not found.', isError: true }
    ctx.onViewOps?.(result.receipt)
    const refreshed = ctx.workspace.pagePayload(ctx.pageId!)
    const inspection = refreshed ? inspectView(refreshed.view, refreshed.records) : null
    return {
      content: JSON.stringify(
        {
          applied: result.receipt.applied,
          skipped: result.receipt.skipped,
          orphanedRecords: result.receipt.orphanedRecords,
          inspection,
          note:
            result.receipt.skipped.length > 0
              ? 'Some ops were skipped — re-read the view with view_get and retry with current node ids.'
              : inspection?.valid
                ? 'All ops applied and the resulting View passed capability/binding inspection.'
                : 'Ops applied, but inspection found errors. Call view_inspect and repair them before claiming success.'
        },
        null,
        2
      ),
      details: { receipt: result.receipt }
    }
  }
}

const recordCreateTool: ToolDef = {
  name: 'record_create',
  description:
    'Create a structured content record (kind: richtext | table | list | metric | fields) and return its stable id. Bind it with view_applyOps setBind. This is how content survives redesigns.',
  mutates: true,
  parameters: Type.Object({
    kind: Type.String({ description: 'richtext | table | list | metric | fields' }),
    label: Type.Optional(Type.String()),
    data: Type.Any({ description: 'Kind-specific payload. table: {columns:[{name,type}], rows:[{cells:{}}]}. metric: {value,unit,format}. fields: {fields:[{name,type}], values:{}}. list: {items:[{text}]}. richtext: {blocks:[...]}' })
  }),
  async execute(input, ctx) {
    if (!ctx.projectId || !ctx.pageId) return { content: 'No project open.', isError: true }
    const kind = String(input.kind ?? '')
    const data = (input.data ?? {}) as Record<string, unknown>
    const now = nowIso()
    let record: import('@shared/types').ContentRecord
    switch (kind) {
      case 'richtext':
        record = {
          id: newId('record'),
          kind: 'richtext',
          label: input.label as string | undefined,
          doc: normalizeDoc({ type: 'doc', blocks: Array.isArray(data.blocks) ? data.blocks : [] } as import('@shared/richtext').RichDoc),
          createdAt: now,
          updatedAt: now
        }
        break
      case 'table': {
        const aliases = new Map<string, string>()
        const usedIds = new Set<string>()
        const columns = (Array.isArray(data.columns) ? data.columns : []).map((c, index) => {
          const col = c as Record<string, unknown>
          const requestedId = typeof col.id === 'string' && isId(col.id, 'block') ? col.id : null
          const id = requestedId && !usedIds.has(requestedId) ? requestedId : newId('block')
          usedIds.add(id)
          const name = String(col.name ?? `Column ${index + 1}`)
          aliases.set(name, id)
          aliases.set(String(index), id)
          if (typeof col.id === 'string') aliases.set(col.id, id)
          return {
            id,
            name,
            type: (['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(String(col.type))
              ? String(col.type)
              : 'text') as import('@shared/types').TableColumn['type'],
            options: Array.isArray(col.options) ? col.options.map(String) : undefined
          }
        })
        const rows = (Array.isArray(data.rows) ? data.rows : []).map((r) => {
          const row = r as Record<string, unknown>
          const rawCells = row.cells && typeof row.cells === 'object' ? row.cells as Record<string, unknown> : {}
          const cells: Record<string, import('@shared/types').TableCellValue> = {}
          for (const [key, value] of Object.entries(rawCells)) {
            const columnId = aliases.get(key)
            if (columnId && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)) {
              cells[columnId] = value
            }
          }
          for (const column of columns) if (!(column.id in cells)) cells[column.id] = null
          return { id: typeof row.id === 'string' && isId(row.id, 'block') ? row.id : newId('block'), cells }
        })
        record = { id: newId('record'), kind: 'table', label: input.label as string | undefined, columns, rows, createdAt: now, updatedAt: now }
        break
      }
      case 'list':
        record = {
          id: newId('record'),
          kind: 'list',
          label: input.label as string | undefined,
          items: (Array.isArray(data.items) ? data.items : []).map((i) => {
            const item = i as Record<string, unknown>
            return { id: newId('block'), text: String(item.text ?? ''), done: Boolean(item.done) }
          }),
          ordered: Boolean(data.ordered),
          createdAt: now,
          updatedAt: now
        }
        break
      case 'metric':
        record = {
          id: newId('record'),
          kind: 'metric',
          label: input.label as string | undefined,
          value: Number(data.value ?? 0),
          previous: data.previous === undefined ? undefined : Number(data.previous),
          unit: data.unit === undefined ? undefined : String(data.unit),
          format: (['number', 'percent', 'currency'].includes(String(data.format)) ? String(data.format) : 'number') as 'number' | 'percent' | 'currency',
          target: data.target === undefined ? undefined : Number(data.target),
          createdAt: now,
          updatedAt: now
        }
        break
      case 'fields': {
        const aliases = new Map<string, string>()
        const usedIds = new Set<string>()
        const fields = (Array.isArray(data.fields) ? data.fields : []).map((f, index) => {
          const field = f as Record<string, unknown>
          const requestedId = typeof field.id === 'string' && isId(field.id, 'block') ? field.id : null
          const id = requestedId && !usedIds.has(requestedId) ? requestedId : newId('block')
          usedIds.add(id)
          const name = String(field.name ?? `Field ${index + 1}`)
          aliases.set(name, id)
          aliases.set(String(index), id)
          if (typeof field.id === 'string') aliases.set(field.id, id)
          return {
            id,
            name,
            type: (['text', 'longtext', 'number', 'date', 'select', 'checkbox', 'url'].includes(String(field.type))
              ? String(field.type)
              : 'text') as import('@shared/types').FieldDef['type'],
            options: Array.isArray(field.options) ? field.options.map(String) : undefined,
            required: Boolean(field.required),
            help: field.help === undefined ? undefined : String(field.help)
          }
        })
        const rawValues = data.values && typeof data.values === 'object' ? data.values as Record<string, unknown> : {}
        const values: Record<string, import('@shared/types').TableCellValue> = {}
        for (const [key, value] of Object.entries(rawValues)) {
          const fieldId = aliases.get(key)
          if (fieldId && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)) values[fieldId] = value
        }
        record = {
          id: newId('record'),
          kind: 'fields',
          label: input.label as string | undefined,
          fields,
          values,
          createdAt: now,
          updatedAt: now
        }
        break
      }
      default:
        return { content: `Unsupported kind: ${kind}`, isError: true }
    }
    const saved = ctx.workspace.createRecord(ctx.projectId, record, ctx.pageId)
    const schema = saved.kind === 'table'
      ? { columns: saved.columns.map(({ id, name, type }) => ({ id, name, type })) }
      : saved.kind === 'fields'
        ? { fields: saved.fields.map(({ id, name, type }) => ({ id, name, type })) }
        : undefined
    return {
      content: JSON.stringify({ message: `Created ${saved.kind} record ${saved.id}${saved.label ? ` ("${saved.label}")` : ''}.`, recordId: saved.id, ...schema }, null, 2),
      details: { recordId: saved.id, ...schema }
    }
  }
}

const recordUpdateTool: ToolDef = {
  name: 'record_update',
  description: 'Update an existing content record by stable id. Use for appending rows, changing metric values or editing form fields.',
  mutates: true,
  parameters: Type.Object({
    recordId: Type.String(),
    patch: Type.Any({ description: 'Fields to merge into the record (e.g. { value: 42 } or { rows: [...] })' })
  }),
  async execute(input, ctx) {
    if (!ctx.projectId) return { content: 'No project open.', isError: true }
    const recordId = String(input.recordId ?? '')
    const updated = ctx.workspace.updateRecord(ctx.projectId, recordId, (input.patch ?? {}) as Partial<import('@shared/types').ContentRecord>)
    if (!updated) return { content: `Record ${recordId} not found.`, isError: true }
    return { content: `Updated record ${recordId}.`, details: { recordId } }
  }
}

const recordCellValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
const recordCellsSchema = Type.Record(Type.String(), recordCellValueSchema)
const recordActionSchema = Type.Union([
  Type.Object({ type: Type.Literal('row.create'), cells: Type.Optional(recordCellsSchema), rowId: Type.Optional(Type.String()) }),
  Type.Object({ type: Type.Literal('row.update'), rowId: Type.String(), cells: recordCellsSchema }),
  Type.Object({
    type: Type.Literal('row.move'), rowId: Type.String(), groupField: Type.Optional(Type.String()),
    groupValue: Type.Optional(recordCellValueSchema), beforeRowId: Type.Optional(Type.String())
  }),
  Type.Object({ type: Type.Literal('row.archive'), rowId: Type.String(), archived: Type.Optional(Type.Boolean()) }),
  Type.Object({ type: Type.Literal('row.delete'), rowId: Type.String() }),
  Type.Object({ type: Type.Literal('row.duplicate'), rowId: Type.String() }),
  Type.Object({
    type: Type.Literal('column.options'), columnId: Type.String(), options: Type.Array(Type.String()),
    rename: Type.Optional(Type.Object({ from: Type.String(), to: Type.String() })),
    removedValue: Type.Optional(Type.String()), reassignTo: Type.Optional(Type.String())
  }),
  Type.Object({ type: Type.Literal('fields.update'), values: recordCellsSchema }),
  Type.Object({ type: Type.Literal('fields.submit'), values: recordCellsSchema, clear: Type.Optional(Type.Boolean()) }),
  Type.Object({ type: Type.Literal('list.create'), text: Type.String() }),
  Type.Object({ type: Type.Literal('list.update'), itemId: Type.String(), text: Type.Optional(Type.String()), done: Type.Optional(Type.Boolean()) }),
  Type.Object({ type: Type.Literal('list.delete'), itemId: Type.String() }),
  Type.Object({ type: Type.Literal('metric.set'), value: Type.Number() }),
  Type.Object({ type: Type.Literal('undo') })
])

const recordActionTool: ToolDef = {
  name: 'record_action',
  description: 'Apply one validated, stable-ID record action and return an auditable receipt. Prefer this over broad record_update patches for row, lane-option, form, list and metric edits. Actions: row.create/update/move/archive/delete/duplicate, column.options, fields.update/submit, list.create/update/delete, metric.set, or undo. Re-read with view_get after schema changes.',
  mutates: true,
  parameters: Type.Object({
    recordId: Type.String({ description: 'Stable record id.' }),
    action: recordActionSchema,
    expectedRevision: Type.Optional(Type.Number({ description: 'Revision from view_get; rejects stale edits when supplied.' }))
  }),
  async execute(input, ctx) {
    if (!ctx.projectId) return { content: 'No project open.', isError: true }
    const recordId = String(input.recordId ?? '')
    if (!isId(recordId, 'record')) return { content: 'Invalid record id.', isError: true }
    const action = input.action as Record<string, unknown> | undefined
    if (!action || typeof action.type !== 'string') return { content: 'action.type is required.', isError: true }
    const service = new RecordActionService(ctx.workspace)
    try {
      const receipt = action.type === 'undo'
        ? service.undo(ctx.projectId, recordId)
        : service.execute(
            ctx.projectId,
            recordId,
            action as import('@shared/recordActions').RecordAction,
            input.expectedRevision === undefined ? undefined : Number(input.expectedRevision)
          )
      if (!receipt) return { content: 'Nothing to undo.', isError: true }
      const result = {
        receiptId: receipt.id,
        action: receipt.action,
        summary: receipt.summary,
        recordId: receipt.record.id,
        revision: receipt.record.revision ?? 0,
        affectedId: receipt.affectedId,
        canUndo: receipt.canUndo,
        inspection: ctx.pageId
          ? (() => {
              const refreshed = ctx.workspace.pagePayload(ctx.pageId)
              return refreshed ? inspectView(refreshed.view, refreshed.records) : null
            })()
          : null
      }
      return { content: JSON.stringify(result, null, 2), details: result }
    } catch (error) {
      return { content: error instanceof Error ? error.message : 'Record action failed.', isError: true }
    }
  }
}

const recordListTool: ToolDef = {
  name: 'record_list',
  description: 'List every content record in the current project, including orphaned ones, with ids and labels.',
  parameters: Type.Object({}),
  async execute(_input, ctx) {
    if (!ctx.projectId) return { content: 'No project open.', isError: true }
    const records = Object.values(ctx.workspace.allRecords(ctx.projectId))
    if (records.length === 0) return { content: 'No records yet.' }
    return {
      content: records
        .map((r) => `${r.id}  ${r.kind.padEnd(9)} ${r.orphaned ? '[orphaned] ' : ''}${r.label ?? ''}`)
        .join('\n')
    }
  }
}

const pageInfoTool: ToolDef = {
  name: 'page_info',
  description: 'List projects and pages in the workspace with their ids, so you can navigate and place content correctly.',
  parameters: Type.Object({}),
  async execute(_input, ctx) {
    const snapshot = ctx.workspace.snapshot()
    const lines: string[] = []
    for (const project of snapshot.index.projects) {
      lines.push(`PROJECT ${project.id}  ${project.name}`)
      for (const pageId of snapshot.index.projectPages[project.id] ?? []) {
        const page = snapshot.index.pages[pageId]
        if (!page) continue
        lines.push(`  PAGE ${pageId}  view=${page.viewId}  "${page.title}"`)
      }
    }
    return { content: lines.join('\n') || 'Empty workspace.' }
  }
}

export const FILE_TOOLS: ToolDef[] = [readTool, writeTool, grepTool, lsTool]
export const WORKSPACE_TOOLS: ToolDef[] = [
  pageInfoTool,
  viewGetTool,
  viewInspectTool,
  viewApplyOpsTool,
  recordCreateTool,
  recordActionTool,
  recordUpdateTool,
  recordListTool
]

export function allTools(): ToolDef[] {
  return [...WORKSPACE_TOOLS, ...FILE_TOOLS]
}

export function readOnlyTools(): ToolDef[] {
  return allTools().filter((tool) => !tool.mutates)
}

export function buildToolContext(
  workspace: WorkspaceStore,
  pageId: string | null,
  onViewOps?: ToolContext['onViewOps']
): ToolContext {
  return {
    workspace,
    pageId,
    projectId: pageId ? workspace.projectIdForPage(pageId) : null,
    onViewOps
  }
}
