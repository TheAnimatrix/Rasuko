import { isId } from './ids'
import type { ContentRecord, TableCellValue, ViewDoc, ViewNode } from './types'
import { getComponent, ROOT_TYPES } from './viewSchema'
import { inspectView } from './viewCapabilities'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const scalar = (value: unknown): value is TableCellValue =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

function matchesFieldValue(
  value: unknown,
  field: { type: string; options?: string[] }
): boolean {
  if (value === null) return true
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (field.type === 'checkbox') return typeof value === 'boolean'
  if (typeof value !== 'string') return false
  return field.type !== 'select' || value === '' || !field.options?.length || field.options.includes(value)
}

function validDate(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function validateProps(node: ViewNode, errors: string[]): void {
  const spec = getComponent(node.type)
  if (!spec || node.props === undefined) return
  if (!node.props || typeof node.props !== 'object' || Array.isArray(node.props)) {
    errors.push(`${node.id}: props must be an object`)
    return
  }
  for (const [key, value] of Object.entries(node.props)) {
    const prop = spec.props[key]
    if (!prop) {
      errors.push(`${node.id}: unsupported property ${key}`)
      continue
    }
    let valid = true
    if (prop.kind === 'string' || prop.kind === 'text' || prop.kind === 'color' || prop.kind === 'icon') valid = typeof value === 'string'
    else if (prop.kind === 'number') valid = typeof value === 'number' && Number.isFinite(value) && (prop.min === undefined || value >= prop.min) && (prop.max === undefined || value <= prop.max)
    else if (prop.kind === 'boolean') valid = typeof value === 'boolean'
    else if (prop.kind === 'enum') valid = typeof value === 'string' && Boolean(prop.values?.includes(value))
    else if (prop.kind === 'stringList') valid = Array.isArray(value) && value.every((item) => typeof item === 'string')
    else if (prop.kind === 'node') valid = Boolean(value && typeof value === 'object')
    if (!valid) errors.push(`${node.id}: invalid ${key}`)
  }
}

export function validateContentRecord(record: unknown): ValidationResult {
  const errors: string[] = []
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record must be an object'] }
  const input = record as ContentRecord & { revision?: unknown; schemaVersion?: unknown }
  if (!isId(input.id, 'record')) errors.push('record requires a stable record id')
  if (!validDate(input.createdAt) || !validDate(input.updatedAt)) errors.push(`${input.id}: invalid timestamps`)
  if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0)) errors.push(`${input.id}: revision must be a non-negative integer`)
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) errors.push(`${input.id}: unsupported schemaVersion ${String(input.schemaVersion)}`)
  const unique = (ids: unknown[], label: string) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!isId(id, 'block') || seen.has(id)) errors.push(`${input.id}: ${label} require unique stable block ids`)
      else seen.add(id)
    }
  }
  if (input.kind === 'richtext') {
    if (!input.doc || input.doc.type !== 'doc' || !Array.isArray(input.doc.blocks)) errors.push(`${input.id}: richtext requires a document`)
    else {
      unique(input.doc.blocks.map((block) => block?.id), 'blocks')
      const blockTypes = new Set(['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote', 'code', 'callout', 'divider', 'image', 'table'])
      for (const block of input.doc.blocks) {
        if (!block || typeof block !== 'object') { errors.push(`${input.id}: invalid block`); continue }
        if (!blockTypes.has(block.type)) errors.push(`${input.id}: invalid block type`)
        if ('runs' in block && (!Array.isArray(block.runs) || block.runs.some((run) => typeof run?.text !== 'string'))) errors.push(`${input.id}: block ${block.id} has invalid runs`)
        if (block.type === 'heading' && ![1, 2, 3].includes(block.level)) errors.push(`${input.id}: heading ${block.id} has invalid level`)
        if (['bullet', 'numbered', 'todo'].includes(block.type) && ('indent' in block && block.indent !== undefined) && (!Number.isInteger(block.indent) || block.indent! < 0)) errors.push(`${input.id}: list block ${block.id} has invalid indent`)
        if (block.type === 'todo' && block.checked !== undefined && typeof block.checked !== 'boolean') errors.push(`${input.id}: todo ${block.id} has invalid checked state`)
        if (block.type === 'code' && typeof block.text !== 'string') errors.push(`${input.id}: code ${block.id} requires text`)
        if (block.type === 'image' && typeof block.src !== 'string') errors.push(`${input.id}: image ${block.id} requires src`)
        if (block.type === 'table' && (!Array.isArray(block.rows) || block.rows.some((row) => !Array.isArray(row) || row.some((cell) => !Array.isArray(cell) || cell.some((run) => typeof run?.text !== 'string'))))) errors.push(`${input.id}: table block ${block.id} is invalid`)
      }
    }
  } else if (input.kind === 'table') {
    if (!Array.isArray(input.columns) || !Array.isArray(input.rows)) errors.push(`${input.id}: table requires columns and rows`)
    else {
      unique(input.columns.map((column) => column?.id), 'columns')
      unique(input.rows.map((row) => row?.id), 'rows')
      const columns = new Map(input.columns.filter(Boolean).map((column) => [column.id, column]))
      for (const column of input.columns) {
        if (!column || typeof column !== 'object') { errors.push(`${input.id}: invalid column`); continue }
        if (typeof column.name !== 'string' || !['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(column.type)) errors.push(`${input.id}: invalid column ${column.id ?? ''}`)
        if (column.options !== undefined && (column.type !== 'select' || !Array.isArray(column.options) || column.options.some((value) => typeof value !== 'string') || new Set(column.options).size !== column.options.length)) errors.push(`${input.id}: invalid options for column ${column.id}`)
      }
      for (const row of input.rows) {
        if (!row || typeof row !== 'object') { errors.push(`${input.id}: invalid row`); continue }
        if (!row.cells || typeof row.cells !== 'object' || Array.isArray(row.cells)) errors.push(`${input.id}: invalid row ${row.id ?? ''}`)
        else for (const [key, value] of Object.entries(row.cells)) {
          const column = columns.get(key)
          if (!column) errors.push(`${input.id}: row ${row.id} references missing column ${key}`)
          else if (!scalar(value) || !matchesFieldValue(value, column)) errors.push(`${input.id}: row ${row.id} has an invalid value for ${key}`)
        }
        if ('archived' in row && typeof (row as { archived?: unknown }).archived !== 'boolean') errors.push(`${input.id}: row ${row.id} archived must be boolean`)
      }
    }
  } else if (input.kind === 'list') {
    if (!Array.isArray(input.items)) errors.push(`${input.id}: list requires items`)
    else {
      unique(input.items.map((item) => item?.id), 'items')
      if (input.items.some((item) => typeof item?.text !== 'string' || (item.done !== undefined && typeof item.done !== 'boolean'))) errors.push(`${input.id}: invalid list item`)
    }
  } else if (input.kind === 'metric') {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) errors.push(`${input.id}: metric value must be finite`)
    if (input.series && (!Array.isArray(input.series) || input.series.some((point) => !point || typeof point.label !== 'string' || !Number.isFinite(point.value)))) errors.push(`${input.id}: invalid metric series`)
  } else if (input.kind === 'fields') {
    if (!Array.isArray(input.fields) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) errors.push(`${input.id}: fields record requires fields and values`)
    else {
      unique(input.fields.map((field) => field?.id), 'fields')
      for (const field of input.fields) {
        if (!field || typeof field !== 'object') { errors.push(`${input.id}: invalid field`); continue }
        if (typeof field.name !== 'string' || !field.name.trim() || !['text', 'longtext', 'number', 'date', 'select', 'checkbox', 'url'].includes(field.type)) errors.push(`${input.id}: invalid field ${field.id ?? ''}`)
        if (field.options !== undefined && (field.type !== 'select' || !Array.isArray(field.options) || field.options.some((value) => typeof value !== 'string') || new Set(field.options).size !== field.options.length)) errors.push(`${input.id}: invalid options for field ${field.id}`)
      }
      const fields = new Map(input.fields.filter(Boolean).map((field) => [field.id, field]))
      for (const [key, value] of Object.entries(input.values)) {
        const field = fields.get(key)
        if (!field) errors.push(`${input.id}: values reference missing field ${key}`)
        else if (!scalar(value) || !matchesFieldValue(value, field)) errors.push(`${input.id}: field ${key} has an invalid value`)
      }
      const entryIds = new Set<string>()
      if (input.entries !== undefined && !Array.isArray(input.entries)) errors.push(`${input.id}: entries must be an array`)
      if (input.entries) for (const entry of input.entries) {
        if (!entry || typeof entry !== 'object') { errors.push(`${input.id}: invalid entry`); continue }
        if (!isId(entry.id, 'block') || !validDate(entry.createdAt)) errors.push(`${input.id}: invalid entry ${entry.id}`)
        if (entryIds.has(entry.id)) errors.push(`${input.id}: duplicate entry ${entry.id}`)
        entryIds.add(entry.id)
        for (const [key, value] of Object.entries(entry.values ?? {})) {
          const field = fields.get(key)
          if (!field || !scalar(value) || !matchesFieldValue(value, field)) errors.push(`${input.id}: invalid entry field ${key}`)
        }
      }
    }
  } else errors.push(`${String((record as { id?: unknown }).id)}: unsupported record kind`)
  return { valid: errors.length === 0, errors }
}

export function validateViewDoc(view: unknown, records?: Readonly<Record<string, ContentRecord>>): ValidationResult {
  const errors: string[] = []
  if (!view || typeof view !== 'object') return { valid: false, errors: ['view must be an object'] }
  const input = view as ViewDoc & { revision?: unknown; schemaVersion?: unknown }
  if (!isId(input.id, 'view')) errors.push('view requires a stable view id')
  if (!input.root || !ROOT_TYPES.includes(input.root.type as 'page')) errors.push(`${input.id}: root must be page`)
  if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0)) errors.push(`${input.id}: revision must be a non-negative integer`)
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) errors.push(`${input.id}: unsupported schemaVersion ${String(input.schemaVersion)}`)
  const seen = new Set<string>()
  const active = new Set<ViewNode>()
  const visit = (node: ViewNode, parent?: ViewNode) => {
    if (!node || typeof node !== 'object') { errors.push('view contains an invalid child'); return }
    if (active.has(node)) { errors.push(`${node.id ?? 'node'}: cycle detected`); return }
    active.add(node)
    if (!isId(node.id, 'node') || seen.has(node.id)) errors.push(`${node.id}: node ids must be unique stable ids`)
    else seen.add(node.id)
    const spec = getComponent(node.type)
    if (!spec) errors.push(`${node.id}: unknown component ${node.type}`)
    if (parent && ROOT_TYPES.includes(node.type as 'page')) errors.push(`${node.id}: page is only valid as the root`)
    const parentSpec = parent && getComponent(parent.type)
    if (parentSpec && (parentSpec.accepts === null || (parentSpec.accepts !== 'any' && !parentSpec.accepts.includes(node.type)))) errors.push(`${parent.id}: ${parent.type} cannot contain ${node.type}`)
    if (node.span !== undefined && (!Number.isInteger(node.span) || node.span < 1 || node.span > 12)) errors.push(`${node.id}: span must be an integer from 1 to 12`)
    validateProps(node, errors)
    if (node.bind) {
      if (!isId(node.bind.recordId, 'record')) errors.push(`${node.id}: binding requires a stable record id`)
      if (!spec || spec.bindable === false) errors.push(`${node.id}: ${node.type} is not bindable`)
      if (node.bind.mode !== undefined && !['value', 'editor', 'list'].includes(node.bind.mode)) errors.push(`${node.id}: invalid binding mode`)
      const record = records?.[node.bind.recordId]
      if (records && !record) errors.push(`${node.id}: binding references missing record ${node.bind.recordId}`)
      if (record && spec) {
        const compatible = spec.bindable === 'block' ? record.kind === 'richtext' : Array.isArray(spec.bindable) && spec.bindable.includes(record.kind)
        if (!compatible) errors.push(`${node.id}: ${node.type} cannot bind ${record.kind}`)
        if (node.bind.blockIds) {
          if (record.kind !== 'richtext') errors.push(`${node.id}: blockIds require richtext`)
          else {
            const blocks = new Set(record.doc.blocks.map((block) => block.id))
            for (const id of node.bind.blockIds) if (!blocks.has(id)) errors.push(`${node.id}: binding references missing block ${id}`)
          }
        }
        if (node.bind.field) {
          const candidates = record.kind === 'table' ? record.columns : record.kind === 'fields' ? record.fields : []
          if (!candidates.some((field) => field.id === node.bind!.field || field.name === node.bind!.field)) errors.push(`${node.id}: binding references missing field ${node.bind.field}`)
        }
      }
    }
    const children = node.children ?? []
    if (!Array.isArray(children)) errors.push(`${node.id}: children must be an array`)
    else {
      if (spec?.accepts === null && children.length) errors.push(`${node.id}: ${node.type} cannot contain children`)
      for (const child of children) visit(child, node)
    }
    active.delete(node)
  }
  if (input.root) visit(input.root)
  if (errors.length === 0 && records) {
    const inspection = inspectView(input, { ...records })
    for (const issue of inspection.issues) {
      // Unbound placeholders are valid while a View is being assembled. They
      // remain visible as capability diagnostics without blocking persistence.
      if (issue.severity === 'error' && issue.code !== 'binding-required') errors.push(`${issue.nodeId}: ${issue.message}`)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function assertValidRecord(record: unknown): asserts record is ContentRecord {
  const result = validateContentRecord(record)
  if (!result.valid) throw new Error(`Invalid record: ${result.errors.join('; ')}`)
}

export function assertValidView(view: unknown, records?: Readonly<Record<string, ContentRecord>>): asserts view is ViewDoc {
  const result = validateViewDoc(view, records)
  if (!result.valid) throw new Error(`Invalid View: ${result.errors.join('; ')}`)
}
