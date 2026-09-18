import type { TableCellValue, TableRecord, TableRow } from './types'
import { validateCell } from './recordActions'

export interface TableFilter {
  field: string
  op: 'eq' | 'neq' | 'contains' | 'lt' | 'lte' | 'gt' | 'gte' | 'empty' | 'notEmpty'
  value?: TableCellValue
}
export interface TableQuery {
  search?: string
  filters?: TableFilter[]
  sort?: { field: string; direction: 'asc' | 'desc' }[]
  archived?: 'exclude' | 'include' | 'only'
}

function compare(a: TableCellValue | undefined, b: TableCellValue | undefined): number {
  if (a == null || a === '') return b == null || b === '' ? 0 : 1
  if (b == null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const left = String(a).toLowerCase(), right = String(b).toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

/** A projection: never mutates or copies the dataset back into storage. */
export function queryTable(record: TableRecord, query: TableQuery = {}): TableRow[] {
  const fields = new Set(record.columns.map((column) => column.id))
  for (const item of [...(query.filters ?? []), ...(query.sort ?? [])]) if (!fields.has(item.field)) throw new Error(`Query refers to missing field: ${item.field}`)
  for (const filter of query.filters ?? []) {
    const column = record.columns.find((column) => column.id === filter.field)!
    if (filter.op === 'empty' || filter.op === 'notEmpty') continue
    if (filter.op === 'contains') {
      if (typeof filter.value !== 'string') throw new Error('Contains filters require search text')
      continue
    }
    if (!['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(filter.op)) throw new Error('Unsupported filter operator')
    validateCell(column, filter.value)
    if (['lt', 'lte', 'gt', 'gte'].includes(filter.op) && (column.type === 'checkbox' || filter.value == null || filter.value === '')) throw new Error('Ordered filters require a nonempty text, date or number value')
  }
  for (const sort of query.sort ?? []) if (!['asc', 'desc'].includes(sort.direction)) throw new Error('Sort direction must be asc or desc')
  const search = query.search?.trim().toLowerCase()
  const rows = record.rows.filter((row) => {
    if ((query.archived ?? 'exclude') === 'exclude' && row.archived) return false
    if (query.archived === 'only' && !row.archived) return false
    if (search && !Object.values(row.cells).some((value) => String(value ?? '').toLowerCase().includes(search))) return false
    return (query.filters ?? []).every((filter) => {
      const value = row.cells[filter.field]
      switch (filter.op) {
        case 'eq': return value === filter.value
        case 'neq': return value !== filter.value
        case 'contains': return String(value ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase())
        case 'empty': return value == null || value === ''
        case 'notEmpty': return value != null && value !== ''
        case 'lt': return value != null && value !== '' && compare(value, filter.value) < 0
        case 'lte': return value != null && value !== '' && compare(value, filter.value) <= 0
        case 'gt': return value != null && value !== '' && compare(value, filter.value) > 0
        case 'gte': return value != null && value !== '' && compare(value, filter.value) >= 0
        default: throw new Error('Unsupported filter operator')
      }
    })
  })
  if (query.sort?.length) rows.sort((a, b) => {
    for (const rule of query.sort!) {
      const order = compare(a.cells[rule.field], b.cells[rule.field])
      if (order) return order * (rule.direction === 'desc' ? -1 : 1)
    }
    return 0
  })
  return rows
}

export function groupRows(record: TableRecord, field: string, query: TableQuery = {}): { value: TableCellValue; rows: TableRow[] }[] {
  const column = record.columns.find((column) => column.id === field)
  if (!column) throw new Error(`Missing grouping field: ${field}`)
  const groups = new Map<TableCellValue, TableRow[]>((column.options ?? []).map((option) => [option, []]))
  for (const row of queryTable(record, query)) {
    const value = row.cells[field] ?? null
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value)!.push(row)
  }
  return Array.from(groups, ([value, rows]) => ({ value, rows }))
}

export function aggregateRows(record: TableRecord, query: TableQuery, operation: 'count' | 'sum' | 'average' | 'min' | 'max', field?: string): number {
  const rows = queryTable(record, query)
  if (operation === 'count') return rows.length
  if (!field || record.columns.find((column) => column.id === field)?.type !== 'number') throw new Error('Numeric aggregates require a number field')
  const values = rows.map((row) => row.cells[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!values.length) return 0
  const sum = values.reduce((a, b) => a + b, 0)
  if (operation === 'sum') return sum
  if (operation === 'average') return sum / values.length
  return values.reduce((a, b) => operation === 'min' ? Math.min(a, b) : Math.max(a, b))
}
