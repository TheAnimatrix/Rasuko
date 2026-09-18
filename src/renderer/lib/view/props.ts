/**
 * Shared helpers for the deterministic View runtime.
 *
 * Everything here is a pure function of a node + the page's records. No content
 * is ever stored on a node — a renderer resolves a binding to a record and reads
 * from it, which is what keeps a View redesign-proof.
 */

import { getComponent } from '@shared/viewSchema'
import type {
  Binding,
  ContentRecord,
  TableCellValue,
  TableColumn,
  ViewNode
} from '@shared/types'
import { defaultRecordLabel, partialDocFor } from '@shared/viewOps'
import { blockPlainText, runText, type RichDoc } from '@shared/richtext'

/* ------------------------------------------------------------------ *
 * Prop access
 * ------------------------------------------------------------------ */

/**
 * Read a node prop. Resolution order: the node's own value → the registry's
 * declared default → the caller's fallback. Keeps renderers declarative.
 */
export function prop<T>(node: ViewNode, key: string, fallback: T): T {
  const raw = node.props?.[key]
  if (raw !== undefined && raw !== null) return raw as T
  const declared = getComponent(node.type)?.props?.[key]?.default
  if (declared !== undefined && declared !== null) return declared as T
  return fallback
}

/* ------------------------------------------------------------------ *
 * 12-column span → static Tailwind classes
 * ------------------------------------------------------------------ */

/**
 * Tailwind cannot see dynamically-built class names, so every span is a literal
 * here. Applies full width below `md` and the requested span at `md` and up.
 */
const SPAN_CLASSES: Record<number, string> = {
  1: 'col-span-12 md:col-span-1',
  2: 'col-span-12 md:col-span-2',
  3: 'col-span-12 md:col-span-3',
  4: 'col-span-12 md:col-span-4',
  5: 'col-span-12 md:col-span-5',
  6: 'col-span-12 md:col-span-6',
  7: 'col-span-12 md:col-span-7',
  8: 'col-span-12 md:col-span-8',
  9: 'col-span-12 md:col-span-9',
  10: 'col-span-12 md:col-span-10',
  11: 'col-span-12 md:col-span-11',
  12: 'col-span-12 md:col-span-12'
}

export function spanClass(span: number | null | undefined): string {
  const n = Math.min(12, Math.max(1, Math.round(span ?? 12)))
  return SPAN_CLASSES[n] ?? SPAN_CLASSES[12]
}

/* ------------------------------------------------------------------ *
 * Binding resolution
 * ------------------------------------------------------------------ */

export function bindingRecord(
  records: Record<string, ContentRecord>,
  binding: Binding | undefined
): ContentRecord | null {
  if (!binding) return null
  return records[binding.recordId] ?? null
}

export function bindingDoc(
  records: Record<string, ContentRecord>,
  binding: Binding | undefined
): RichDoc | null {
  return partialDocFor(bindingRecord(records, binding) ?? undefined, binding ?? { recordId: '' })
}

/* ------------------------------------------------------------------ *
 * Table normalisation
 * ------------------------------------------------------------------ */

export interface NormalizedColumn {
  id: string
  name: string
  type: TableColumn['type']
  options?: string[]
  width?: number
}

export interface NormalizedRow {
  id: string
  cells: Record<string, TableCellValue>
}

/** Tolerant read of a table record: missing columns and cells never throw. */
export function tableRows(record: ContentRecord | null | undefined, includeArchived = false): {
  columns: NormalizedColumn[]
  rows: NormalizedRow[]
} {
  if (!record || record.kind !== 'table') return { columns: [], rows: [] }
  const rawColumns = Array.isArray(record.columns) ? record.columns : []
  let columns: NormalizedColumn[] = rawColumns.map((column) => ({
    id: column.id,
    name: column.name || column.id,
    type: column.type ?? 'text',
    options: column.options,
    width: column.width
  }))
  const rows: NormalizedRow[] = (Array.isArray(record.rows) ? record.rows : []).filter((row) => includeArchived || !row.archived).map((row) => ({
    id: row.id,
    cells: { ...(row.cells ?? {}) }
  }))
  if (columns.length === 0) {
    const keys: string[] = []
    for (const row of rows) {
      for (const key of Object.keys(row.cells)) if (!keys.includes(key)) keys.push(key)
    }
    columns = keys.map((key) => ({ id: key, name: key, type: 'text' as const }))
  }
  for (const row of rows) {
    for (const column of columns) {
      if (!(column.id in row.cells)) row.cells[column.id] = null
    }
  }
  return { columns, rows }
}

/** Project a table (or metric) record into a label/value series for charts. */
export function seriesFromTable(
  record: ContentRecord | null | undefined,
  labelField?: string,
  valueField?: string
): Array<{ label: string; value: number }> {
  if (!record) return []
  if (record.kind === 'metric') {
    if (Array.isArray(record.series) && record.series.length > 0) {
      return record.series
        .map((point) => ({ label: String(point.label), value: Number(point.value) }))
        .filter((point) => Number.isFinite(point.value))
    }
    return [{ label: record.label ?? 'Value', value: Number(record.value) }]
  }
  const { columns, rows } = tableRows(record)
  if (columns.length === 0 || rows.length === 0) return []
  const byName = (name?: string): NormalizedColumn | undefined =>
    name ? columns.find((column) => column.name === name || column.id === name) : undefined
  const labelColumn = byName(labelField) ?? columns[0]
  const numericColumns = columns.filter(
    (column) => column.type === 'number' && column.id !== labelColumn.id
  )
  const valueColumn =
    byName(valueField) ?? numericColumns[0] ?? columns.find((column) => column.id !== labelColumn.id)
  if (!valueColumn) return []
  const out: Array<{ label: string; value: number }> = []
  for (const row of rows) {
    const rawLabel = row.cells[labelColumn.id]
    const label = rawLabel === null || rawLabel === undefined ? '' : String(rawLabel)
    const rawValue = row.cells[valueColumn.id]
    const value =
      typeof rawValue === 'number'
        ? rawValue
        : Number(String(rawValue ?? '').replace(/[^0-9.eE+-]/g, ''))
    if (!Number.isFinite(value)) continue
    out.push({ label: label.trim() || String(out.length + 1), value })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Records → text / labels
 * ------------------------------------------------------------------ */

export function recordLabel(record: ContentRecord | null | undefined): string {
  if (!record) return 'Content'
  return record.label?.trim() || defaultRecordLabel(record)
}

export function firstBlockText(doc: RichDoc | null | undefined): string {
  const block = doc?.blocks?.[0]
  if (!block) return ''
  if ('runs' in block) return runText(block.runs)
  return blockPlainText(block)
}

/** Flatten any record into plain text (used by "Convert to a text block"). */
export function recordPlainText(record: ContentRecord | null | undefined): string {
  if (!record) return ''
  switch (record.kind) {
    case 'richtext':
      return record.doc.blocks
        .map((block) => blockPlainText(block))
        .filter((text) => text.length > 0)
        .join('\n\n')
    case 'table': {
      const { columns, rows } = tableRows(record, true)
      return rows
        .map((row) => columns.map((column) => String(row.cells[column.id] ?? '')).join(' | '))
        .join('\n')
    }
    case 'list':
      return record.items.map((item) => item.text).join('\n')
    case 'metric':
      return `${record.label ?? ''} ${record.value}${record.unit ?? ''}`.trim()
    case 'fields':
      return record.fields
        .map((field) => `${field.name}: ${String(record.values[field.id] ?? '')}`)
        .join('\n')
    default:
      return ''
  }
}

export function kindIcon(kind: string): string {
  switch (kind) {
    case 'richtext':
      return 'document-line'
    case 'table':
      return 'table-line'
    case 'list':
      return 'list-ordered-line'
    case 'metric':
      return 'chart-line-line'
    case 'fields':
      return 'edit-line'
    default:
      return 'box-line'
  }
}

/* ------------------------------------------------------------------ *
 * Tone tokens
 * ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const TONE_SOFT: Record<string, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  info: 'bg-info/12 text-info',
  success: 'bg-success/14 text-success',
  warning: 'bg-warning/18 text-warning',
  danger: 'bg-destructive/12 text-destructive'
}

const TONE_BORDER: Record<string, string> = {
  neutral: 'border-border bg-secondary/40',
  info: 'border-info/25 bg-info/6',
  success: 'border-success/25 bg-success/8',
  warning: 'border-warning/30 bg-warning/10',
  danger: 'border-destructive/25 bg-destructive/6'
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive'
}

const TONE_ACCENT: Record<string, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  info: 'bg-info/15 text-info',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/18 text-warning',
  danger: 'bg-destructive/12 text-destructive'
}

export function toneSoft(tone: unknown): string {
  return TONE_SOFT[String(tone)] ?? TONE_SOFT.neutral
}

export function toneBorder(tone: unknown): string {
  return TONE_BORDER[String(tone)] ?? TONE_BORDER.neutral
}

export function toneText(tone: unknown): string {
  return TONE_TEXT[String(tone)] ?? TONE_TEXT.neutral
}

export function toneAccent(tone: unknown): string {
  return TONE_ACCENT[String(tone)] ?? TONE_ACCENT.neutral
}

export function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && value in TONE_SOFT
}
