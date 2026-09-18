import { isId, newId, nowIso } from './ids'
import type { ContentRecord, FieldDef, TableCellValue, TableColumn, TableRecord } from './types'

/** Serializable operations target data identity, independently of any renderer. */
export type RecordAction =
  | { type: 'row.create'; cells?: Record<string, TableCellValue>; rowId?: string }
  | { type: 'row.update'; rowId: string; cells: Record<string, TableCellValue> }
  | { type: 'row.move'; rowId: string; groupField?: string; groupValue?: TableCellValue; beforeRowId?: string }
  | { type: 'row.archive'; rowId: string; archived?: boolean }
  | { type: 'row.delete'; rowId: string }
  | { type: 'row.duplicate'; rowId: string }
  | { type: 'column.options'; columnId: string; options: string[]; rename?: { from: string; to: string }; removedValue?: string; reassignTo?: string }
  | { type: 'fields.update'; values: Record<string, TableCellValue> }
  | { type: 'fields.submit'; values: Record<string, TableCellValue>; clear?: boolean }
  | { type: 'list.create'; text: string }
  | { type: 'list.update'; itemId: string; text?: string; done?: boolean }
  | { type: 'list.delete'; itemId: string }
  | { type: 'metric.set'; value: number }

export interface RecordActionReceipt {
  id: string
  record: ContentRecord
  action: RecordAction['type'] | 'undo'
  summary: string
  affectedId?: string
  canUndo: boolean
}

export function validateCell(field: TableColumn | FieldDef, value: unknown): asserts value is TableCellValue {
  if (value === null || (value === '' && field.type !== 'number' && field.type !== 'checkbox')) return
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field.name} requires a finite number`)
  } else if (field.type === 'checkbox') {
    if (typeof value !== 'boolean') throw new Error(`${field.name} requires a boolean`)
  } else {
    if (typeof value !== 'string') throw new Error(`${field.name} requires text`)
    if (field.type === 'select' && !(field.options ?? []).includes(value)) throw new Error(`${field.name}: select one of the configured options`)
    if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`${field.name} requires a valid date (YYYY-MM-DD)`)
    if (field.type === 'url') {
      let url: URL
      try { url = new URL(value) } catch { throw new Error(`${field.name} requires a valid URL`) }
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${field.name} requires an HTTP or HTTPS URL`)
    }
  }
}

function validateValues(fields: (TableColumn | FieldDef)[], values: Record<string, TableCellValue>, required = false): void {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Values must be keyed by stable field IDs')
  for (const [id, value] of Object.entries(values)) {
    const field = fields.find((f) => f.id === id)
    if (!field) throw new Error(`Unknown field ID: ${id}`)
    validateCell(field, value)
  }
  if (required) for (const field of fields) {
    if ('required' in field && field.required && (values[field.id] == null || values[field.id] === '')) throw new Error(`${field.name} is required`)
  }
}

/** Pure reducer. The persistence boundary supplies the latest revision. */
export function applyRecordAction(source: ContentRecord, action: RecordAction): { record: ContentRecord; summary: string; affectedId?: string } {
  const record = structuredClone(source)
  if (action.type.startsWith('row.') || action.type === 'column.options') {
    if (record.kind !== 'table') throw new Error(`${action.type} requires a table record`)
    return applyTableAction(record, action as Extract<RecordAction, { type: `row.${string}` | 'column.options' }>)
  }
  switch (action.type) {
    case 'fields.update':
    case 'fields.submit': {
      if (record.kind !== 'fields') throw new Error(`${action.type} requires a fields record`)
      validateValues(record.fields, action.values)
      const values = { ...record.values, ...action.values }
      if (action.type === 'fields.submit') {
        validateValues(record.fields, values, true)
        const entry = { id: newId('block'), values: { ...values }, createdAt: nowIso() }
        record.entries = [...(record.entries ?? []), entry]
        record.values = action.clear ? {} : values
        return { record, summary: 'Submitted entry', affectedId: entry.id }
      }
      record.values = values
      return { record, summary: 'Updated fields' }
    }
    case 'list.create': {
      if (record.kind !== 'list') throw new Error('list.create requires a list record')
      if (!action.text.trim()) throw new Error('Enter an item title')
      const item = { id: newId('block'), text: action.text, done: false }
      record.items.push(item)
      return { record, summary: 'Created item', affectedId: item.id }
    }
    case 'list.update':
    case 'list.delete': {
      if (record.kind !== 'list') throw new Error(`${action.type} requires a list record`)
      const item = record.items.find((item) => item.id === action.itemId)
      if (!item) throw new Error('The item no longer exists; reload before editing')
      if (action.type === 'list.delete') record.items = record.items.filter((item) => item.id !== action.itemId)
      else {
        if (action.text !== undefined) item.text = action.text
        if (action.done !== undefined) item.done = action.done
      }
      return { record, summary: action.type === 'list.delete' ? 'Deleted item' : 'Updated item', affectedId: item.id }
    }
    case 'metric.set':
      if (record.kind !== 'metric') throw new Error('metric.set requires a metric record')
      if (!Number.isFinite(action.value)) throw new Error('Metric value must be finite')
      record.value = action.value
      return { record, summary: 'Updated metric' }
    default: throw new Error(`Unsupported record action: ${(action as { type: string }).type}`)
  }
}

function applyTableAction(record: TableRecord, action: Extract<RecordAction, { type: `row.${string}` | 'column.options' }>): { record: TableRecord; summary: string; affectedId?: string } {
  if (action.type === 'column.options') {
    const column = record.columns.find((column) => column.id === action.columnId)
    if (!column || !['text', 'select'].includes(column.type)) throw new Error('Lane options require an existing text or select field')
    if (!Array.isArray(action.options) || action.options.some((v) => typeof v !== 'string' || !v.trim()) || new Set(action.options).size !== action.options.length) throw new Error('Options must be distinct, nonempty labels')
    if (action.rename && (!action.options.includes(action.rename.to) || action.options.includes(action.rename.from))) throw new Error('Renaming must replace the old option with its new label')
    if (action.removedValue !== undefined) {
      if (action.options.includes(action.removedValue)) throw new Error('Remove the old option from the new options list')
      const populated = record.rows.some((row) => row.cells[column.id] === action.removedValue)
      if (populated && (action.reassignTo === undefined || !action.options.includes(action.reassignTo))) throw new Error('Removing a populated option requires an existing destination option')
    }
    for (const row of record.rows) {
      const value = row.cells[column.id]
      if (action.rename && value === action.rename.from) row.cells[column.id] = action.rename.to
      if (action.removedValue !== undefined && value === action.removedValue) row.cells[column.id] = action.reassignTo!
      const nextValue = row.cells[column.id]
      if (nextValue != null && nextValue !== '' && !action.options.includes(String(nextValue))) throw new Error(`Option "${nextValue}" still contains records. Choose where to move them before removing it`)
    }
    column.type = 'select'
    column.options = [...action.options]
    return { record, summary: 'Updated field options', affectedId: column.id }
  }
  if (action.type === 'row.create') {
    validateValues(record.columns, action.cells ?? {})
    const id = action.rowId ?? newId('block')
    if (!isId(id, 'block') || record.rows.some((row) => row.id === id)) throw new Error('Row ID must be a new stable block ID')
    const cells = Object.fromEntries(record.columns.map((c) => [c.id, c.type === 'checkbox' ? false : null]))
    record.rows.push({ id, cells: { ...cells, ...action.cells } })
    return { record, summary: 'Created record', affectedId: id }
  }
  const row = record.rows.find((row) => row.id === action.rowId)
  if (!row) throw new Error('The record no longer exists; reload before editing')
  switch (action.type) {
    case 'row.update':
      validateValues(record.columns, action.cells)
      row.cells = { ...row.cells, ...action.cells }
      return { record, summary: 'Updated record', affectedId: row.id }
    case 'row.archive':
      row.archived = action.archived ?? true
      return { record, summary: row.archived ? 'Archived record' : 'Restored record', affectedId: row.id }
    case 'row.delete':
      record.rows = record.rows.filter((item) => item.id !== row.id)
      return { record, summary: 'Deleted record', affectedId: row.id }
    case 'row.duplicate': {
      const copy = { ...structuredClone(row), id: newId('block'), archived: false }
      record.rows.splice(record.rows.indexOf(row) + 1, 0, copy)
      return { record, summary: 'Duplicated record', affectedId: copy.id }
    }
    case 'row.move': {
      if (action.groupField !== undefined) {
        validateValues(record.columns, { [action.groupField]: action.groupValue ?? null })
        row.cells[action.groupField] = action.groupValue ?? null
      } else if (action.groupValue !== undefined) throw new Error('Moving a value requires a field ID')
      if (action.beforeRowId === row.id) return { record, summary: 'Moved record', affectedId: row.id }
      const remaining = record.rows.filter((item) => item.id !== row.id)
      const targetIndex = action.beforeRowId === undefined ? remaining.length : remaining.findIndex((item) => item.id === action.beforeRowId)
      if (targetIndex < 0) throw new Error('The destination record no longer exists')
      if (action.beforeRowId && action.groupField && remaining[targetIndex].cells[action.groupField] !== row.cells[action.groupField]) throw new Error('The destination record belongs to a different group')
      remaining.splice(targetIndex, 0, row)
      record.rows = remaining
      return { record, summary: 'Moved record', affectedId: row.id }
    }
  }
}
