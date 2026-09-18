/**
 * Domain entities for a Rasuko workspace.
 *
 * The split is deliberate:
 *   Page    — navigation + wiring (which View, which records)
 *   View    — presentation only (deterministic component tree)
 *   Record  — content only (ID-addressed, survives every redesign)
 */

import type { RichDoc } from './richtext'

export const WORKSPACE_VERSION = 1

/* ------------------------------------------------------------------ *
 * Content records
 * ------------------------------------------------------------------ */

export type RecordKind = 'richtext' | 'table' | 'list' | 'metric' | 'fields'

export interface BaseRecord {
  id: string
  schemaVersion?: number
  revision?: number
  kind: RecordKind
  label?: string
  createdAt: string
  updatedAt: string
  /** Unbound from every View but intentionally kept. */
  orphaned?: boolean
  orphanedAt?: string
  /** View id / page id that last bound this record, for provenance. */
  origin?: string
  tags?: string[]
}

export interface RichTextRecord extends BaseRecord {
  kind: 'richtext'
  doc: RichDoc
}

export interface TableColumn {
  id: string
  name: string
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url'
  options?: string[]
  width?: number
}

export type TableCellValue = string | number | boolean | null

export interface TableRow {
  id: string
  cells: Record<string, TableCellValue>
  /** Archiving changes visibility, never content identity. */
  archived?: boolean
}

export interface TableRecord extends BaseRecord {
  kind: 'table'
  columns: TableColumn[]
  rows: TableRow[]
}

export interface ListRecord extends BaseRecord {
  kind: 'list'
  items: Array<{ id: string; text: string; done?: boolean }>
  ordered?: boolean
}

export interface MetricRecord extends BaseRecord {
  kind: 'metric'
  value: number
  previous?: number
  unit?: string
  format?: 'number' | 'percent' | 'currency'
  series?: Array<{ label: string; value: number }>
  target?: number
}

export interface FieldDef {
  id: string
  name: string
  type: 'text' | 'longtext' | 'number' | 'date' | 'select' | 'checkbox' | 'url'
  options?: string[]
  required?: boolean
  help?: string
}

export interface FieldsRecord extends BaseRecord {
  kind: 'fields'
  fields: FieldDef[]
  values: Record<string, TableCellValue>
  /** Saved rows when the form is used as a repeatable capture surface. */
  entries?: Array<{ id: string; values: Record<string, TableCellValue>; createdAt: string }>
}

export type ContentRecord =
  | RichTextRecord
  | TableRecord
  | ListRecord
  | MetricRecord
  | FieldsRecord

/* ------------------------------------------------------------------ *
 * Binding
 * ------------------------------------------------------------------ */

export interface Binding {
  recordId: string
  /** Partial binding to specific blocks inside a richtext record. */
  blockIds?: string[]
  /** Property of a non-richtext record (e.g. a table column). */
  field?: string
  mode?: 'value' | 'editor' | 'list'
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

export interface ViewNode {
  id: string
  type: string
  props?: Record<string, unknown>
  bind?: Binding
  children?: ViewNode[]
  /** 12-column grid span. */
  span?: number
  locked?: boolean
}

export interface ViewDoc {
  id: string
  schemaVersion?: number
  revision?: number
  name: string
  kind: 'barebones' | 'custom'
  version: number
  /** Registry version this View was authored against. */
  registryVersion: number
  root: ViewNode
  description?: string
  author?: string
  tags?: string[]
  /** Provenance: how this View came to be. */
  createdBy?: 'user' | 'assistant' | 'marketplace'
  /** Prompt that produced the current shape, when assistant-authored. */
  sourcePrompt?: string
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Page + project
 * ------------------------------------------------------------------ */

export interface PageMeta {
  id: string
  schemaVersion?: number
  revision?: number
  projectId: string
  title: string
  icon?: string
  viewId: string
  /** Records owned by this page (for cleanup + search). */
  recordIds: string[]
  /** Markdown input mode. Rendering of stored content never depends on it. */
  markdown: boolean
  createdAt: string
  updatedAt: string
  trashed?: boolean
}

export interface ProjectMeta {
  id: string
  schemaVersion?: number
  revision?: number
  name: string
  icon?: string
  color?: string
  description?: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
}

export interface WorkspaceIndex {
  version: number
  projects: ProjectMeta[]
  pages: Record<string, PageMeta>
  /** pageId per project, in sidebar order. */
  projectPages: Record<string, string[]>
  /** Views owned by a project (plus shared views copied in). */
  projectViews: Record<string, string[]>
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Assistant
 * ------------------------------------------------------------------ */

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  output?: string
  isError?: boolean
  startedAt: string
  finishedAt?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  thinking?: string
  toolCalls?: ChatToolCall[]
  streaming?: boolean
  error?: string
  createdAt: string
}

export interface Conversation {
  id: string
  pageId: string
  messages: ChatMessage[]
  /** Optional for compatibility with the original one-chat-per-page files. */
  createdAt?: string
  /** Derived from the first user message unless the user supplies one later. */
  title?: string
  updatedAt: string
}

export interface ConversationSummary {
  id: string
  pageId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/* ------------------------------------------------------------------ *
 * Ops receipts
 * ------------------------------------------------------------------ */

export interface OpReceipt {
  applied: number
  skipped: Array<{ op: string; target?: string; reason: string }>
  createdNodes: string[]
  removedNodes: string[]
  createdRecords: string[]
  orphanedRecords: string[]
  viewId: string
  viewName: string
  kind: ViewDoc['kind']
  summary: string
}
