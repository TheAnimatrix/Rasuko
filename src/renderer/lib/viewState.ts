import type { FieldDef, TableCellValue } from '@shared/types'
import { validateCell } from '@shared/recordActions'

export interface FormDraftScope {
  projectId: string
  viewId: string
  recordId: string
  projection?: string
}

function storageKey(scope: FormDraftScope): string {
  return `rasuko:form-draft:v1:${[scope.projectId, scope.viewId, scope.recordId, scope.projection ?? '*'].map(encodeURIComponent).join(':')}`
}

function available(): boolean {
  return typeof localStorage !== 'undefined'
}

/** Load only values that still belong to the current schema and type-check. */
export function loadFormDraft(scope: FormDraftScope, fields: readonly FieldDef[]): Record<string, TableCellValue> | null {
  if (!available()) return null
  try {
    const source = localStorage.getItem(storageKey(scope))
    if (!source) return null
    const parsed = JSON.parse(source) as { values?: unknown }
    if (!parsed.values || typeof parsed.values !== 'object' || Array.isArray(parsed.values)) return null
    const raw = parsed.values as Record<string, unknown>
    const values: Record<string, TableCellValue> = {}
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(raw, field.id)) continue
      try {
        validateCell(field, raw[field.id])
        values[field.id] = raw[field.id] as TableCellValue
      } catch {
        // A redesigned schema must not revive an incompatible stale value.
      }
    }
    return values
  } catch {
    return null
  }
}

export function saveFormDraft(scope: FormDraftScope, fields: readonly FieldDef[], source: Record<string, TableCellValue>): boolean {
  if (!available()) return false
  const values: Record<string, TableCellValue> = {}
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field.id)) continue
    try {
      validateCell(field, source[field.id])
      values[field.id] = source[field.id]
    } catch {
      // Keep the usable portion of a draft when one field is temporarily invalid.
    }
  }
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify({ values }))
    return true
  } catch {
    // Do not leave an older draft that looks current after a failed overwrite.
    try { localStorage.removeItem(storageKey(scope)) } catch { /* Storage is unavailable. */ }
    return false
  }
}

export function clearFormDraft(scope: FormDraftScope): void {
  if (!available()) return
  try { localStorage.removeItem(storageKey(scope)) } catch { /* Storage can be unavailable or full. */ }
}
