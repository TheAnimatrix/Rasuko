/**
 * Pure block-model helpers for the rich-text editor.
 *
 * Everything here is framework-free: it takes a `RichDoc` (or a `Block`) and
 * returns a new one. The editor component owns focus, caret and DOM concerns;
 * this module owns structure. That split keeps block identity (the binding
 * granularity for custom Views) intact through every edit.
 */

import {
  type Block,
  type BlockType,
  type CodeBlock,
  type ListBlock,
  type Mark,
  type RichDoc,
  type Run,
  blockHasRuns,
  blockPlainText,
  markKey,
  normalizeDoc,
  paragraph,
  runsToPlainText,
  splitRuns
} from '@shared/richtext'

export interface MarkdownTransform {
  type: BlockType
  level?: 1 | 2 | 3
  checked?: boolean
  tone?: 'info' | 'success' | 'warning' | 'danger'
  /** Number of leading characters to strip once the transform is applied. */
  strip: number
}

/* ------------------------------------------------------------------ *
 * Doc lookups + immutable edits
 * ------------------------------------------------------------------ */

export function findBlock(doc: RichDoc, id: string): Block | undefined {
  if (!doc || !Array.isArray(doc.blocks)) return undefined
  return doc.blocks.find((block) => block.id === id)
}

export function blockIndex(doc: RichDoc, id: string): number {
  if (!doc || !Array.isArray(doc.blocks)) return -1
  return doc.blocks.findIndex((block) => block.id === id)
}

export function replaceBlock(doc: RichDoc, id: string, block: Block): RichDoc {
  const index = blockIndex(doc, id)
  if (index < 0) return doc
  const blocks = doc.blocks.slice()
  blocks[index] = block
  return { type: 'doc', blocks }
}

export function insertBlock(doc: RichDoc, index: number, block: Block): RichDoc {
  const blocks = doc && Array.isArray(doc.blocks) ? doc.blocks.slice() : []
  const at = Math.max(0, Math.min(blocks.length, Math.round(index) || 0))
  blocks.splice(at, 0, block)
  return { type: 'doc', blocks }
}

export function removeBlock(doc: RichDoc, id: string): RichDoc {
  const index = blockIndex(doc, id)
  if (index < 0) return doc
  const blocks = doc.blocks.filter((block) => block.id !== id)
  return { type: 'doc', blocks: blocks.length > 0 ? blocks : [paragraph()] }
}

export function updateRuns(doc: RichDoc, id: string, runs: Run[]): RichDoc {
  const block = findBlock(doc, id)
  if (!block || !blockHasRuns(block)) return doc
  return replaceBlock(doc, id, { ...block, runs } as Block)
}

export function updateBlock(doc: RichDoc, id: string, patch: Partial<Block>): RichDoc {
  const block = findBlock(doc, id)
  if (!block) return doc
  return replaceBlock(doc, id, { ...block, ...patch } as Block)
}

/* ------------------------------------------------------------------ *
 * Block type conversion
 * ------------------------------------------------------------------ */

function indentOf(block: Block): number {
  if (block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo') {
    return clampIndent(block.indent ?? 0)
  }
  return 0
}

function clampIndent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(3, Math.max(0, Math.round(value)))
}

/**
 * Convert a block between types, keeping its `id` and `runs` where possible.
 *
 * A block without inline runs (divider / image / table) cannot carry runs
 * forward, so a fresh paragraph is produced instead — never a broken hybrid.
 */
export function setBlockType(block: Block, type: BlockType, level: 1 | 2 | 3 = 1): Block {
  if (!blockHasRuns(block)) return paragraph()
  const runs = block.runs
  const id = block.id
  const indent = indentOf(block)
  switch (type) {
    case 'paragraph':
      return { id, type: 'paragraph', runs }
    case 'heading':
      return { id, type: 'heading', level, runs }
    case 'bullet':
      return { id, type: 'bullet', indent, runs }
    case 'numbered':
      return { id, type: 'numbered', indent, runs }
    case 'todo':
      return {
        id,
        type: 'todo',
        checked: block.type === 'todo' ? Boolean(block.checked) : false,
        indent,
        runs
      }
    case 'quote':
      return { id, type: 'quote', runs }
    case 'callout':
      return {
        id,
        type: 'callout',
        tone: block.type === 'callout' ? block.tone ?? 'info' : 'info',
        runs
      }
    case 'code':
      return {
        id,
        type: 'code',
        language: undefined,
        text: runsToPlainText(runs)
      }
    default:
      return { id, type: 'paragraph', runs }
  }
}

export function setCalloutTone(
  block: Block,
  tone: 'info' | 'success' | 'warning' | 'danger'
): Block {
  if (!blockHasRuns(block)) return block
  if (block.type === 'callout') return { ...block, tone }
  return setBlockType({ ...block, type: 'callout', tone } as Block, 'callout')
}

/* ------------------------------------------------------------------ *
 * Moving + indenting
 * ------------------------------------------------------------------ */

export function moveBlock(doc: RichDoc, id: string, delta: number): RichDoc {
  const index = blockIndex(doc, id)
  if (index < 0) return doc
  const target = index + Math.round(delta)
  if (target < 0 || target >= doc.blocks.length) return doc
  const blocks = doc.blocks.slice()
  const [block] = blocks.splice(index, 1)
  blocks.splice(target, 0, block)
  return { type: 'doc', blocks }
}

export function indentBlock(doc: RichDoc, id: string, delta: number): RichDoc {
  const block = findBlock(doc, id)
  if (!block) return doc
  if (block.type !== 'bullet' && block.type !== 'numbered' && block.type !== 'todo') return doc
  const next = clampIndent((block as ListBlock).indent ?? 0) + Math.round(delta)
  return replaceBlock(doc, id, { ...block, indent: clampIndent(next) } as Block)
}

/* ------------------------------------------------------------------ *
 * Markdown input affordance
 * ------------------------------------------------------------------ */

/**
 * Match a block-level markdown token at the very START of a block's text.
 *
 * Only ever consulted in Markdown mode: content is still stored as structured
 * blocks, so this is an input convenience, never a storage format.
 */
export function markdownTransform(text: string): MarkdownTransform | null {
  if (typeof text !== 'string' || text.length === 0) return null

  if (text.startsWith('### ')) return { type: 'heading', level: 3, strip: 4 }
  if (text.startsWith('## ')) return { type: 'heading', level: 2, strip: 3 }
  if (text.startsWith('# ')) return { type: 'heading', level: 1, strip: 2 }

  const task = text.match(/^[-*+]\s+\[([ xX])\]\s+/)
  if (task) return { type: 'todo', checked: task[1].toLowerCase() === 'x', strip: task[0].length }

  if (text.startsWith('[ ] ')) return { type: 'todo', checked: false, strip: 4 }
  if (text.startsWith('[] ')) return { type: 'todo', checked: false, strip: 3 }
  if (text.startsWith('[x] ') || text.startsWith('[X] '))
    return { type: 'todo', checked: true, strip: 4 }

  if (text.startsWith('- ') || text.startsWith('* ') || text.startsWith('+ '))
    return { type: 'bullet', strip: 2 }

  const numbered = text.match(/^(\d+[.)] )/)
  if (numbered) return { type: 'numbered', strip: numbered[1].length }

  if (text.startsWith('!!! ')) return { type: 'callout', tone: 'danger', strip: 4 }
  if (text.startsWith('!! ')) return { type: 'callout', tone: 'warning', strip: 3 }
  if (text.startsWith('! ')) return { type: 'callout', tone: 'info', strip: 2 }

  if (text.startsWith('> ')) return { type: 'quote', strip: 2 }

  if (/^-{3,}$/.test(text)) return { type: 'divider', strip: text.length }

  if (text.startsWith('```')) return { type: 'code', strip: 3 }

  return null
}

/**
 * Re-read an existing document as Markdown.
 *
 * Used when Markdown mode is switched ON: text that was typed or pasted without
 * live formatting is reinterpreted so `- item`, `[ ] task`, `# heading`,
 * `> quote` and inline `**bold**` become real blocks and runs. Block ids are
 * preserved when a block converts in place, so bindings to individual blocks
 * survive the switch. Non-textual blocks (code, tables, images, dividers) are
 * left untouched.
 */
function blockSignature(block: Block): string {
  return `${block.type}\u0000${blockPlainText(block)}`
}

/**
 * Carry block ids over from a previous document onto a freshly parsed one.
 *
 * Plaintext mode edits the whole document as one string and re-parses it, which
 * would mint all-new ids and break block bindings. This aligns old and new
 * blocks (longest common subsequence of type+text, then same-type leftovers in
 * order) so untouched blocks — and quietly edited lines of the same kind — keep
 * their identity.
 */
export function preserveBlockIds(next: RichDoc, previous: RichDoc): RichDoc {
  const a = previous.blocks
  const b = next.blocks
  const blocks: Block[] = b.map((block) => ({ ...block }) as Block)
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return { type: 'doc', blocks }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        blockSignature(a[i]) === blockSignature(b[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const usedA = new Set<number>()
  const usedB = new Set<number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (blockSignature(a[i]) === blockSignature(b[j])) {
      blocks[j].id = a[i].id
      usedA.add(i)
      usedB.add(j)
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }

  const freeA = a.map((_, index) => index).filter((index) => !usedA.has(index))
  const freeB = blocks.map((_, index) => index).filter((index) => !usedB.has(index))
  let x = 0
  let y = 0
  while (x < freeA.length && y < freeB.length) {
    if (a[freeA[x]].type === blocks[freeB[y]].type) {
      blocks[freeB[y]].id = a[freeA[x]].id
      x += 1
      y += 1
    } else {
      y += 1
    }
  }

  return { type: 'doc', blocks }
}

/**
 * Merge an edited block projection back into its complete source document.
 *
 * Custom Views can bind a rich component to a subset of a record with
 * `blockIds`. The editor must never save that projection as the whole record:
 * doing so would delete every block the View did not render. Existing selected
 * blocks keep their position among hidden blocks, edits replace them by stable
 * id, and new blocks are placed next to the selected block after which they
 * were created. Omitting a selected block deletes only that selected block.
 */
export function mergeProjectedBlocks(
  source: RichDoc,
  projection: RichDoc,
  blockIds: readonly string[]
): RichDoc {
  const selected = new Set(blockIds)
  if (selected.size === 0) return normalizeDoc(projection)

  const replacements = new Map<string, Block>()
  const additions = new Map<string | null, Block[]>()
  const projectedIds = new Set(projection.blocks.map((block) => block.id))
  let anchor: string | null = null

  for (const block of projection.blocks) {
    if (selected.has(block.id)) {
      replacements.set(block.id, block)
      anchor = block.id
      continue
    }
    const group = additions.get(anchor) ?? []
    group.push(block)
    additions.set(anchor, group)
  }

  const blocks: Block[] = []
  let reachedProjection = false
  for (const block of source.blocks) {
    if (!selected.has(block.id)) {
      // A previous queued save may already have inserted this projected block
      // while the editor still carries the old binding IDs. Move it through
      // the projection below instead of rendering the same stable ID twice.
      if (projectedIds.has(block.id)) continue
      blocks.push(block)
      continue
    }

    if (!reachedProjection) {
      blocks.push(...(additions.get(null) ?? []))
      reachedProjection = true
    }
    const replacement = replacements.get(block.id)
    if (replacement) blocks.push(replacement)
    blocks.push(...(additions.get(block.id) ?? []))
  }

  // A stale binding should be a no-op rather than an accidental append.
  return reachedProjection ? { type: 'doc', blocks } : source
}

export function markdownifyDoc(doc: RichDoc): RichDoc {
  const blocks = doc.blocks.map((block): Block => {
    if (!blockHasRuns(block)) return block
    const text = runsToPlainText(block.runs)
    const transform = markdownTransform(text)
    let next: Block = block
    let source = text
    if (transform) {
      if (transform.type === 'divider') return { id: block.id, type: 'divider' }
      source = text.slice(transform.strip)
      next = setBlockType(block, transform.type, transform.level ?? 1)
      if (transform.type === 'callout') {
        next = setCalloutTone(next, transform.tone ?? 'info')
      }
    }
    if (next.type === 'code') return { ...(next as CodeBlock), text: source }
    if (!blockHasRuns(next)) return next
    return { ...next, runs: applyInlineMarkdown(textToRuns(source)) } as Block
  })
  return { type: 'doc', blocks }
}

const INLINE_TOKEN =
  /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

function normalizedMark(mark: Mark): string {
  return typeof mark === 'string' ? mark : JSON.stringify(mark)
}

function marksEqual(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  const keysA = left.map(normalizedMark).sort()
  const keysB = right.map(normalizedMark).sort()
  return keysA.every((key, index) => key === keysB[index])
}

/** Append a run, coalescing with the previous one when their marks match. */
export function appendRun(out: Run[], text: string, marks: Mark[] = []): void {
  if (text.length === 0) return
  const last = out[out.length - 1]
  if (last && marksEqual(last.marks, marks)) {
    last.text += text
    return
  }
  out.push(marks.length > 0 ? { text, marks } : { text })
}

/** Collapse adjacent runs that carry identical marks. */
export function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs ?? []) appendRun(out, run.text ?? '', run.marks)
  return out
}

/**
 * Turn CLOSED inline markdown tokens into marks.
 *
 * Unterminated trailing tokens (e.g. a half-typed `**bold`) are left untouched
 * so the user's in-progress syntax is never eaten. Existing marks are preserved
 * and unioned with any token marks over the same range.
 */
export function applyInlineMarkdown(runs: Run[]): Run[] {
  const source = Array.isArray(runs) ? runs : []
  const text = runsToPlainText(source)
  if (text.length === 0) return source.map((run) => ({ ...run }))

  const charMarks: Mark[][] = []
  for (const run of source) {
    const marks = Array.isArray(run.marks) ? run.marks : []
    for (let i = 0; i < run.text.length; i += 1) charMarks.push(marks)
  }

  const out: Run[] = []
  const push = (start: number, end: number, extra: Mark[] = []): void => {
    if (end <= start) return
    const marks: Mark[] = []
    const seen = new Set<string>()
    for (let i = start; i < end; i += 1) {
      for (const mark of charMarks[i] ?? []) {
        const key = markKey(mark)
        if (!seen.has(key)) {
          seen.add(key)
          marks.push(mark)
        }
      }
    }
    for (const mark of extra) {
      const key = markKey(mark)
      if (!seen.has(key)) {
        seen.add(key)
        marks.push(mark)
      }
    }
    appendRun(out, text.slice(start, end), marks)
  }

  let cursor = 0
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0
    if (index < cursor) continue
    const token = match[0]
    const end = index + token.length
    if (index > cursor) push(cursor, index)
    if (token.startsWith('***') && token.endsWith('***')) {
      push(index + 3, end - 3, ['bold', 'italic'])
    } else if (token.startsWith('**') && token.endsWith('**')) {
      push(index + 2, end - 2, ['bold'])
    } else if (token.startsWith('__') && token.endsWith('__')) {
      push(index + 2, end - 2, ['bold'])
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      push(index + 2, end - 2, ['strike'])
    } else if (token.startsWith('`') && token.endsWith('`')) {
      push(index + 1, end - 1, ['code'])
    } else if (token.startsWith('*') && token.endsWith('*')) {
      push(index + 1, end - 1, ['italic'])
    } else if (token.startsWith('_') && token.endsWith('_')) {
      push(index + 1, end - 1, ['italic'])
    } else if (token.startsWith('[')) {
      const close = token.indexOf('](')
      const label = token.slice(1, close)
      const url = token.slice(close + 2, -1)
      push(index + 1, index + 1 + label.length, [{ link: url }])
    }
    cursor = end
  }
  if (cursor < text.length) push(cursor, text.length)
  return out
}

/**
 * Rebuild runs from freshly-typed plain text while carrying marks over for the
 * unchanged prefix. Everything after the shared prefix is stored unmarked.
 */
export function rebuildRuns(text: string, previous: Run[]): Run[] {
  const prev = Array.isArray(previous) ? previous : []
  if (prev.length === 0) return textToRuns(text)
  const prevText = runsToPlainText(prev)
  const max = Math.min(text.length, prevText.length)
  let prefix = 0
  while (prefix < max && text[prefix] === prevText[prefix]) prefix += 1
  const { before } = splitRuns(prev, prefix)
  const out: Run[] = before.map((run) => ({ ...run }))
  const rest = text.slice(prefix)
  if (rest.length > 0) appendRun(out, rest)
  return mergeRuns(out)
}

/** Cut runs into `[before, middle, after]` at a character range. */
export function sliceRuns(runs: Run[], start: number, end: number): { before: Run[]; mid: Run[]; after: Run[] } {
  const from = Math.max(0, Math.min(start, end))
  const to = Math.max(start, end)
  const { before, after } = splitRuns(runs ?? [], from)
  const { before: mid, after: tail } = splitRuns(after, to - from)
  return { before, mid, after: tail }
}

export function runsToText(runs: Run[] | undefined): string {
  return runsToPlainText(runs ?? [])
}

export function textToRuns(text: string): Run[] {
  return text.length > 0 ? [{ text }] : []
}
