/**
 * View ops — the only way a View is ever mutated by the assistant.
 *
 * Ops are total functions: an op targeting a node that no longer exists is
 * skipped and reported rather than throwing. A stale plan therefore degrades
 * gracefully instead of corrupting a View.
 */

import { newId, nowIso } from './ids'
import type { Binding, ContentRecord, OpReceipt, ViewDoc, ViewNode } from './types'
import {
  ROOT_TYPES,
  getComponent,
  isComponentType,
  sanitizeProps,
  defaultProps
} from './viewSchema'
import { normalizeBlock, paragraph, type Block } from './richtext'
import type { RichDoc } from './richtext'
import { validateViewDoc } from './viewValidation'

export type ViewOp =
  | { op: 'setRoot'; node: ViewNode }
  | { op: 'insert'; parent: string; index?: number; node: ViewNode }
  | { op: 'replace'; target: string; node: ViewNode }
  | { op: 'remove'; target: string }
  | { op: 'move'; target: string; parent: string; index?: number }
  | { op: 'setProps'; target: string; props: Record<string, unknown> }
  | { op: 'setSpan'; target: string; span: number }
  | { op: 'setBind'; target: string; bind: Binding | null }
  | { op: 'setName'; name: string }
  | { op: 'setKind'; kind: 'barebones' | 'custom' }

/* ------------------------------------------------------------------ *
 * Node construction + validation
 * ------------------------------------------------------------------ */

export function makeNode(type: string, init: Partial<ViewNode> = {}): ViewNode {
  const node: ViewNode = {
    id: init.id && typeof init.id === 'string' ? init.id : newId('node'),
    type,
    props: { ...defaultProps(type), ...sanitizeProps(type, init.props) }
  }
  if (init.bind) node.bind = init.bind
  if (init.children) node.children = init.children
  if (typeof init.span === 'number') node.span = clampSpan(init.span)
  if (init.locked) node.locked = true
  return node
}

export function clampSpan(span: number): number {
  return Math.min(12, Math.max(1, Math.round(span)))
}

/**
 * Repair an arbitrary (possibly AI-authored) node tree so it is always legal
 * against the registry. Never throws — returns the repaired tree + warnings.
 */
export function coerceNode(raw: unknown, warnings: string[] = []): ViewNode | null {
  if (!raw || typeof raw !== 'object') {
    warnings.push('node was not an object')
    return null
  }
  const input = raw as Partial<ViewNode> & { type?: unknown }
  if (!isComponentType(input.type)) {
    warnings.push(`unknown component type "${String(input.type)}" — dropped`)
    return null
  }
  const spec = getComponent(input.type)!
  const node = makeNode(input.type, {
    id: typeof input.id === 'string' ? input.id : undefined,
    props: (input.props ?? {}) as Record<string, unknown>,
    span: typeof input.span === 'number' ? input.span : undefined,
    locked: input.locked
  })
  if (input.bind && typeof input.bind === 'object' && typeof input.bind.recordId === 'string') {
    node.bind = {
      recordId: input.bind.recordId,
      blockIds: Array.isArray(input.bind.blockIds)
        ? input.bind.blockIds.filter((b): b is string => typeof b === 'string')
        : undefined,
      field: typeof input.bind.field === 'string' ? input.bind.field : undefined,
      mode: input.bind.mode
    }
  }
  const children = Array.isArray(input.children) ? input.children : []
  const coerced = children
    .map((child) => coerceNode(child, warnings))
    .filter((c): c is ViewNode => c !== null)

  if (spec.accepts === null) {
    if (coerced.length > 0) warnings.push(`${spec.type} does not accept children — dropped ${coerced.length}`)
    return node
  }
  if (spec.accepts !== 'any') {
    const allowed = new Set(spec.accepts)
    const filtered = coerced.filter((child) => {
      if (allowed.has(child.type)) return true
      warnings.push(`${spec.type} cannot contain ${child.type} — dropped`)
      return false
    })
    if (filtered.length > 0) node.children = filtered
    return node
  }
  if (coerced.length > 0) node.children = coerced
  return node
}

export function coerceView(raw: unknown): { view: ViewDoc; warnings: string[] } {
  const warnings: string[] = []
  const input = (raw ?? {}) as Partial<ViewDoc>
  const rootCandidate = coerceNode(input.root, warnings)
  const root =
    rootCandidate && ROOT_TYPES.includes(rootCandidate.type as (typeof ROOT_TYPES)[number])
      ? rootCandidate
      : makeNode('page', { children: rootCandidate ? [rootCandidate] : [] })
  if (rootCandidate && root !== rootCandidate) warnings.push('view root was not a `page` — wrapped it')
  const now = nowIso()
  return {
    view: {
      id: typeof input.id === 'string' ? input.id : newId('view'),
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Untitled View',
      kind: input.kind === 'barebones' ? 'barebones' : 'custom',
      version: 1,
      registryVersion: 1,
      root,
      description: typeof input.description === 'string' ? input.description : undefined,
      author: typeof input.author === 'string' ? input.author : undefined,
      tags: Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : undefined,
      createdBy: input.createdBy,
      sourcePrompt: input.sourcePrompt,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
      updatedAt: now
    },
    warnings
  }
}

/** Walk helpers */
export function walk(node: ViewNode, visit: (n: ViewNode, parent: ViewNode | null) => void): void {
  const rec = (n: ViewNode, parent: ViewNode | null) => {
    visit(n, parent)
    for (const child of n.children ?? []) rec(child, n)
  }
  rec(node, null)
}

export function findNode(root: ViewNode, id: string): ViewNode | null {
  let found: ViewNode | null = null
  walk(root, (n) => {
    if (n.id === id) found = n
  })
  return found
}

export function findParent(root: ViewNode, id: string): ViewNode | null {
  let found: ViewNode | null = null
  walk(root, (n, parent) => {
    if (n.id === id) found = parent
  })
  return found
}

export function collectBindings(root: ViewNode): Binding[] {
  const out: Binding[] = []
  walk(root, (n) => {
    if (n.bind) out.push(n.bind)
  })
  return out
}

export function collectNodeIds(root: ViewNode): string[] {
  const out: string[] = []
  walk(root, (n) => out.push(n.id))
  return out
}

/* ------------------------------------------------------------------ *
 * Op application
 * ------------------------------------------------------------------ */

export interface ApplyResult {
  view: ViewDoc
  receipt: OpReceipt
}

export function applyViewOps(
  view: ViewDoc,
  ops: ViewOp[],
  options: { summary?: string } = {}
): ApplyResult {
  let next: ViewDoc = structuredClone(view)
  const receipt: OpReceipt = {
    applied: 0,
    skipped: [],
    createdNodes: [],
    removedNodes: [],
    createdRecords: [],
    orphanedRecords: [],
    viewId: next.id,
    viewName: next.name,
    kind: next.kind,
    summary: options.summary ?? ''
  }

  const index: ViewNode[] = []
  walk(next.root, (n) => index.push(n))

  const incomingErrors = (node: ViewNode, root: boolean): string[] => validateViewDoc({
    ...view,
    root: root ? node : { id: newId('node'), type: 'page', props: {}, children: [node] }
  }).errors

  const track = (node: ViewNode) => {
    walk(node, (n) => {
      receipt.createdNodes.push(n.id)
      index.push(n)
    })
  }

  for (const op of ops) {
    const before = structuredClone(next)
    const appliedBefore = receipt.applied
    const createdBefore = receipt.createdNodes.length
    const removedBefore = receipt.removedNodes.length
    try {
      switch (op.op) {
        case 'setRoot': {
          const strictErrors = incomingErrors(op.node, true)
          if (strictErrors.length) {
            receipt.skipped.push({ op: op.op, reason: strictErrors.join('; ') })
            break
          }
          const warnings: string[] = []
          const node = coerceNode(op.node, warnings)
          if (!node || warnings.length || !ROOT_TYPES.includes(node.type as (typeof ROOT_TYPES)[number])) {
            receipt.skipped.push({ op: op.op, reason: warnings.join('; ') || 'root must be a page node' })
            break
          }
          receipt.removedNodes.push(...collectNodeIds(next.root))
          next.root = node
          track(node)
          receipt.applied += 1
          break
        }
        case 'insert': {
          const parent = findNode(next.root, op.parent)
          if (!parent) {
            receipt.skipped.push({ op: op.op, target: op.parent, reason: 'parent not found' })
            break
          }
          const strictErrors = incomingErrors(op.node, false)
          if (strictErrors.length) {
            receipt.skipped.push({ op: op.op, target: op.parent, reason: strictErrors.join('; ') })
            break
          }
          const warnings: string[] = []
          const node = coerceNode(op.node, warnings)
          if (!node || warnings.length) {
            receipt.skipped.push({ op: op.op, target: op.parent, reason: warnings.join('; ') || 'node failed validation' })
            break
          }
          const spec = getComponent(parent.type)!
          if (spec.accepts === null) {
            receipt.skipped.push({ op: op.op, target: op.parent, reason: `${parent.type} cannot contain children` })
            break
          }
          if (spec.accepts !== 'any' && !spec.accepts.includes(node.type)) {
            receipt.skipped.push({
              op: op.op,
              target: op.parent,
              reason: `${parent.type} cannot contain ${node.type}`
            })
            break
          }
          parent.children = parent.children ?? []
          const at = clampIndex(op.index, parent.children.length)
          parent.children.splice(at, 0, node)
          track(node)
          receipt.applied += 1
          break
        }
        case 'replace': {
          if (op.target === next.root.id) {
            const strictErrors = incomingErrors(op.node, true)
            if (strictErrors.length) {
              receipt.skipped.push({ op: op.op, target: op.target, reason: strictErrors.join('; ') })
              break
            }
            const warnings: string[] = []
            const node = coerceNode(op.node, warnings)
            if (!node || warnings.length || !ROOT_TYPES.includes(node.type as (typeof ROOT_TYPES)[number])) {
              receipt.skipped.push({ op: op.op, target: op.target, reason: warnings.join('; ') || 'root replacement must be a page' })
              break
            }
            receipt.removedNodes.push(...collectNodeIds(next.root))
            next.root = node
            track(node)
            receipt.applied += 1
            break
          }
          const parent = findParent(next.root, op.target)
          if (!parent || !parent.children) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'target not found' })
            break
          }
          const strictErrors = incomingErrors(op.node, false)
          if (strictErrors.length) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: strictErrors.join('; ') })
            break
          }
          const warnings: string[] = []
          const node = coerceNode(op.node, warnings)
          if (!node || warnings.length) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: warnings.join('; ') || 'node failed validation' })
            break
          }
          const at = parent.children.findIndex((c) => c.id === op.target)
          if (at < 0) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'index out of sync' })
            break
          }
          receipt.removedNodes.push(...collectNodeIds(parent.children[at]))
          parent.children[at] = node
          track(node)
          receipt.applied += 1
          break
        }
        case 'remove': {
          if (op.target === next.root.id) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'cannot remove the root page' })
            break
          }
          const parent = findParent(next.root, op.target)
          if (!parent || !parent.children) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'target not found' })
            break
          }
          const at = parent.children.findIndex((c) => c.id === op.target)
          if (at < 0) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'index out of sync' })
            break
          }
          receipt.removedNodes.push(...collectNodeIds(parent.children[at]))
          parent.children.splice(at, 1)
          receipt.applied += 1
          break
        }
        case 'move': {
          const node = findNode(next.root, op.target)
          const from = findParent(next.root, op.target)
          const to = findNode(next.root, op.parent)
          if (!node || !from || !from.children || !to) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'source or destination missing' })
            break
          }
          if (op.parent === op.target || isDescendant(node, op.parent)) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'cannot move a node into itself' })
            break
          }
          const at = from.children.findIndex((c) => c.id === op.target)
          if (at < 0) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'index out of sync' })
            break
          }
          from.children.splice(at, 1)
          to.children = to.children ?? []
          to.children.splice(clampIndex(op.index, to.children.length), 0, node)
          receipt.applied += 1
          break
        }
        case 'setProps': {
          const node = findNode(next.root, op.target)
          if (!node) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'target not found' })
            break
          }
          const sanitized = sanitizeProps(node.type, op.props)
          if (Object.keys(sanitized).length !== Object.keys(op.props).length || Object.entries(sanitized).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(op.props[key]))) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'props contain unsupported or invalid values' })
            break
          }
          node.props = { ...node.props, ...sanitized }
          receipt.applied += 1
          break
        }
        case 'setSpan': {
          const node = findNode(next.root, op.target)
          if (!node) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'target not found' })
            break
          }
          node.span = clampSpan(op.span)
          receipt.applied += 1
          break
        }
        case 'setBind': {
          const node = findNode(next.root, op.target)
          if (!node) {
            receipt.skipped.push({ op: op.op, target: op.target, reason: 'target not found' })
            break
          }
          node.bind = op.bind ?? undefined
          receipt.applied += 1
          break
        }
        case 'setName': {
          if (!op.name || typeof op.name !== 'string') {
            receipt.skipped.push({ op: op.op, reason: 'name must be a non-empty string' })
            break
          }
          next.name = op.name.trim().slice(0, 120)
          receipt.applied += 1
          break
        }
        case 'setKind': {
          if (op.kind !== 'barebones' && op.kind !== 'custom') {
            receipt.skipped.push({ op: op.op, reason: 'invalid kind' })
            break
          }
          next.kind = op.kind
          receipt.applied += 1
          break
        }
        default: {
          receipt.skipped.push({ op: String((op as { op?: string }).op ?? 'unknown'), reason: 'unknown op' })
        }
      }
      if (receipt.applied > appliedBefore) {
        const validation = validateViewDoc(next)
        if (!validation.valid) {
          next = before
          receipt.applied = appliedBefore
          receipt.createdNodes.length = createdBefore
          receipt.removedNodes.length = removedBefore
          receipt.skipped.push({ op: op.op, target: 'target' in op ? op.target : undefined, reason: validation.errors.join('; ') })
        }
      }
    } catch (error) {
      next = before
      receipt.applied = appliedBefore
      receipt.createdNodes.length = createdBefore
      receipt.removedNodes.length = removedBefore
      receipt.skipped.push({
        op: op.op,
        reason: error instanceof Error ? error.message : 'unknown error'
      })
    }
  }

  next.updatedAt = nowIso()
  receipt.viewName = next.name
  receipt.kind = next.kind
  return { view: next, receipt }
}

function clampIndex(index: number | undefined, length: number): number {
  if (typeof index !== 'number' || !Number.isFinite(index)) return length
  return Math.min(length, Math.max(0, Math.round(index)))
}

function isDescendant(node: ViewNode, candidateId: string): boolean {
  let found = false
  walk(node, (n) => {
    if (n.id === candidateId) found = true
  })
  return found
}

/* ------------------------------------------------------------------ *
 * Binding reconciliation — content never dies with a redesign
 * ------------------------------------------------------------------ */

export interface ReconcileResult {
  orphaned: string[]
  revived: string[]
  /** Bindings pointing at records that no longer exist. */
  dangling: Binding[]
}

export function reconcileRecords(
  view: ViewDoc,
  records: Record<string, ContentRecord>
): ReconcileResult {
  const bound = new Set(collectBindings(view.root).map((b) => b.recordId))
  const orphaned: string[] = []
  const revived: string[] = []
  for (const record of Object.values(records)) {
    if (bound.has(record.id)) {
      if (record.orphaned) {
        record.orphaned = false
        record.orphanedAt = undefined
        revived.push(record.id)
      }
    } else if (!record.orphaned) {
      record.orphaned = true
      record.orphanedAt = nowIso()
      orphaned.push(record.id)
    }
  }
  const dangling = collectBindings(view.root).filter((b) => !records[b.recordId])
  return { orphaned, revived, dangling }
}

/**
 * If a binding disappears, the content must be capable of coming back. We keep
 * the record and remember where it used to live so reattachment is one click.
 */
export function suggestReattachments(
  records: Record<string, ContentRecord>,
  view: ViewDoc
): Array<{ recordId: string; label: string; kind: ContentRecord['kind']; targetNodeId?: string }> {
  const out: Array<{ recordId: string; label: string; kind: ContentRecord['kind']; targetNodeId?: string }> = []
  for (const record of Object.values(records)) {
    if (!record.orphaned) continue
    const target = findCompatibleSlot(view.root, record)
    out.push({
      recordId: record.id,
      label: record.label ?? defaultRecordLabel(record),
      kind: record.kind,
      targetNodeId: target?.id
    })
  }
  return out
}

function findCompatibleSlot(root: ViewNode, record: ContentRecord): ViewNode | null {
  let slot: ViewNode | null = null
  walk(root, (node) => {
    if (slot || node.bind) return
    if (node.type === 'rich' && record.kind === 'richtext') slot = node
    else if (node.type === 'table' && record.kind === 'table') slot = node
    else if (node.type === 'fields' && record.kind === 'fields') slot = node
    else if (node.type === 'metric' && record.kind === 'metric') slot = node
    else if (node.type === 'list' && record.kind === 'list') slot = node
  })
  return slot
}

export function defaultRecordLabel(record: ContentRecord): string {
  switch (record.kind) {
    case 'richtext': {
      const first = record.doc.blocks[0]
      if (first && 'runs' in first) {
        const text = first.runs.map((r) => r.text).join('').trim()
        if (text) return text.slice(0, 48)
      }
      return 'Text'
    }
    case 'table':
      return `${record.rows.length} rows`
    case 'list':
      return `${record.items.length} items`
    case 'metric':
      return `${record.value}${record.unit ?? ''}`
    case 'fields':
      return record.label ?? 'Form'
    default:
      return 'Content'
  }
}

/* ------------------------------------------------------------------ *
 * Barebones <-> custom conversion
 * ------------------------------------------------------------------ */

export function barebonesView(name = 'Notes'): ViewDoc {
  const now = nowIso()
  return {
    id: newId('view'),
    name,
    kind: 'barebones',
    version: 1,
    registryVersion: 1,
    root: makeNode('page', {
      // 32px matches the page-title row's px-8 so the title and the writing
      // surface share one left edge without extra chrome.
      props: { width: 'default', gap: 16, padding: 32 },
      children: [makeNode('rich', { props: { editable: true, showToolbar: true } })]
    }),
    createdBy: 'user',
    createdAt: now,
    updatedAt: now
  }
}

/* ------------------------------------------------------------------ *
 * Records referenced by a View
 * ------------------------------------------------------------------ */

export function collectRecordIds(view: ViewDoc): string[] {
  return [...new Set(collectBindings(view.root).map((b) => b.recordId))]
}

/**
 * Build a partial rich-text doc for a block-scoped binding.
 * Returns null when the record is not a richtext record.
 */
export function partialDocFor(
  record: ContentRecord | undefined,
  binding: Binding
): RichDoc | null {
  if (!record || record.kind !== 'richtext') return null
  if (!binding.blockIds || binding.blockIds.length === 0) return record.doc
  const wanted = new Set(binding.blockIds)
  const blocks = record.doc.blocks.filter((b) => wanted.has(b.id))
  return { type: 'doc', blocks: blocks.length > 0 ? blocks : [paragraph()] }
}

/** Write a bootstrapped block back into its own record. */
export function ensureBlocksInRecord(
  record: ContentRecord,
  blocks: Block[]
): ContentRecord {
  if (record.kind !== 'richtext') return record
  const existing = new Set(record.doc.blocks.map((b) => b.id))
  const additions = blocks.filter((b) => !existing.has(b.id)).map(normalizeBlock).filter((b): b is Block => b !== null)
  if (additions.length === 0) return record
  return { ...record, doc: { type: 'doc', blocks: [...record.doc.blocks, ...additions] } }
}
