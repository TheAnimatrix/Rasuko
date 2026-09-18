/**
 * The Rasuko content model.
 *
 * Markdown is NOT the storage format. Content is a tree of blocks, each with a
 * stable ID, holding inline runs with explicit marks. Markdown is only ever an
 * input affordance (when the user enables it) and an export format.
 *
 * Block IDs are the binding granularity for custom Views: a dashboard may bind
 * to a single heading or paragraph, so blocks must be individually addressable
 * and must survive reordering, splitting and merging.
 */

import { newId } from './ids'

export type Mark =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'code'
  | { link: string }
  | { color: string }

export interface Run {
  text: string
  marks?: Mark[]
}

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'callout'
  | 'divider'
  | 'image'
  | 'table'

export interface ParagraphBlock {
  id: string
  type: 'paragraph'
  runs: Run[]
}
export interface HeadingBlock {
  id: string
  type: 'heading'
  level: 1 | 2 | 3
  runs: Run[]
}
export interface ListBlock {
  id: string
  type: 'bullet' | 'numbered' | 'todo'
  checked?: boolean
  indent?: number
  runs: Run[]
}
export interface QuoteBlock {
  id: string
  type: 'quote'
  runs: Run[]
}
export interface CodeBlock {
  id: string
  type: 'code'
  language?: string
  text: string
}
export interface CalloutBlock {
  id: string
  type: 'callout'
  tone?: 'info' | 'success' | 'warning' | 'danger'
  runs: Run[]
}
export interface DividerBlock {
  id: string
  type: 'divider'
}
export interface ImageBlock {
  id: string
  type: 'image'
  src: string
  alt?: string
}
export interface TableBlock {
  id: string
  type: 'table'
  header: boolean
  rows: Run[][][]
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | CalloutBlock
  | DividerBlock
  | ImageBlock
  | TableBlock

export interface RichDoc {
  type: 'doc'
  blocks: Block[]
}

export const RICH_DOC_VERSION = 1

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export function emptyDoc(): RichDoc {
  return { type: 'doc', blocks: [paragraph()] }
}

export function paragraph(text = ''): ParagraphBlock {
  return { id: newId('block'), type: 'paragraph', runs: text ? [{ text }] : [] }
}

export function heading(level: 1 | 2 | 3, text = ''): HeadingBlock {
  return { id: newId('block'), type: 'heading', level, runs: text ? [{ text }] : [] }
}

export function listItem(
  type: 'bullet' | 'numbered' | 'todo',
  text = '',
  checked = false
): ListBlock {
  return { id: newId('block'), type, checked, runs: text ? [{ text }] : [] }
}

export function callout(tone: CalloutBlock['tone'] = 'info', text = ''): CalloutBlock {
  return { id: newId('block'), type: 'callout', tone, runs: text ? [{ text }] : [] }
}

export function codeBlock(text = '', language = ''): CodeBlock {
  return { id: newId('block'), type: 'code', language: language || undefined, text }
}

export function divider(): DividerBlock {
  return { id: newId('block'), type: 'divider' }
}

export function emptyTable(rows = 3, cols = 3): TableBlock {
  return {
    id: newId('block'),
    type: 'table',
    header: true,
    rows: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [] as Run[])
    )
  }
}

/* ------------------------------------------------------------------ *
 * Run helpers
 * ------------------------------------------------------------------ */

export function runText(runs: Run[] | undefined): string {
  return (runs ?? []).map((r) => r.text).join('')
}

export function markKey(mark: Mark): string {
  return typeof mark === 'string' ? mark : Object.keys(mark)[0]
}

export function hasMark(runs: Run[], mark: Mark): boolean {
  const key = markKey(mark)
  if (runs.length === 0) return false
  return runs.every((r) => (r.marks ?? []).some((m) => markKey(m) === key))
}

export function toggleMarkInRuns(runs: Run[], mark: Mark): Run[] {
  const key = markKey(mark)
  const on = hasMark(runs, mark)
  return runs.map((run) => {
    const marks = run.marks ?? []
    const without = marks.filter((m) => markKey(m) !== key)
    return { ...run, marks: on ? without : [...without, mark] }
  })
}

export function runsToPlainText(runs: Run[]): string {
  return runs.map((r) => r.text).join('')
}

/* ------------------------------------------------------------------ *
 * Block helpers
 * ------------------------------------------------------------------ */

export function blockPlainText(block: Block): string {
  switch (block.type) {
    case 'divider':
      return ''
    case 'image':
      return block.alt ?? ''
    case 'code':
      return block.text
    case 'table':
      return block.rows
        .map((row) => row.map((cell) => runsToPlainText(cell)).join(' | '))
        .join('\n')
    default:
      return runsToPlainText(block.runs)
  }
}

/** Blocks that hold inline runs and therefore support formatting. */
export function blockHasRuns(
  block: Block
): block is Extract<Block, { runs: Run[] }> {
  return 'runs' in block
}

export function isTextualBlock(type: BlockType): boolean {
  return (
    type === 'paragraph' ||
    type === 'heading' ||
    type === 'bullet' ||
    type === 'numbered' ||
    type === 'todo' ||
    type === 'quote' ||
    type === 'callout'
  )
}

/** Split a block's runs at a character offset, preserving marks. */
export function splitRuns(runs: Run[], offset: number): { before: Run[]; after: Run[] } {
  const before: Run[] = []
  const after: Run[] = []
  let seen = 0
  for (const run of runs) {
    const len = run.text.length
    if (seen + len <= offset) {
      before.push({ ...run })
    } else if (seen >= offset) {
      after.push({ ...run })
    } else {
      const cut = offset - seen
      before.push({ ...run, text: run.text.slice(0, cut) })
      after.push({ ...run, text: run.text.slice(cut) })
    }
    seen += len
  }
  return { before, after }
}

/**
 * Split a block into two. The LEFT half keeps the original ID so any existing
 * binding to that block keeps pointing at the text the user was editing.
 */
export function splitBlock(block: Block, offset: number): [Block, Block] {
  if (isTextualBlock(block.type)) {
    const source = block as Extract<Block, { runs: Run[] }>
    const { before, after } = splitRuns(source.runs, offset)
    const left = { ...source, runs: before } as Block
    const right = { ...source, id: newId('block'), runs: after } as Block
    return [left, right]
  }
  return [block, paragraph()]
}

export function cloneBlocksWithNewIds(blocks: Block[]): Block[] {
  return blocks.map((block) => ({ ...structuredClone(block), id: newId('block') }) as Block)
}

export function normalizeDoc(doc: RichDoc | undefined | null): RichDoc {
  if (!doc || !Array.isArray(doc.blocks) || doc.blocks.length === 0) return emptyDoc()
  const blocks = doc.blocks
    .map(normalizeBlock)
    .filter((b): b is Block => b !== null)
  return { type: 'doc', blocks: blocks.length > 0 ? blocks : [paragraph()] }
}

export function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null
  const block = raw as Partial<Block> & { type?: string }
  const id = typeof (block as { id?: string }).id === 'string' ? (block as { id: string }).id : newId('block')
  switch (block.type) {
    case 'paragraph':
      return { id, type: 'paragraph', runs: normalizeRuns((block as ParagraphBlock).runs) }
    case 'heading': {
      const level = (block as HeadingBlock).level
      return {
        id,
        type: 'heading',
        level: level === 2 || level === 3 ? level : 1,
        runs: normalizeRuns((block as HeadingBlock).runs)
      }
    }
    case 'bullet':
    case 'numbered':
    case 'todo':
      return {
        id,
        type: block.type,
        checked: Boolean((block as ListBlock).checked),
        indent: Number.isFinite((block as ListBlock).indent) ? (block as ListBlock).indent : 0,
        runs: normalizeRuns((block as ListBlock).runs)
      }
    case 'quote':
      return { id, type: 'quote', runs: normalizeRuns((block as QuoteBlock).runs) }
    case 'code':
      return {
        id,
        type: 'code',
        text: typeof (block as CodeBlock).text === 'string' ? (block as CodeBlock).text : '',
        language: (block as CodeBlock).language
      }
    case 'callout':
      return {
        id,
        type: 'callout',
        tone: (block as CalloutBlock).tone ?? 'info',
        runs: normalizeRuns((block as CalloutBlock).runs)
      }
    case 'divider':
      return { id, type: 'divider' }
    case 'image':
      return {
        id,
        type: 'image',
        src: (block as ImageBlock).src ?? '',
        alt: (block as ImageBlock).alt
      }
    case 'table': {
      const rows = (block as TableBlock).rows
      return {
        id,
        type: 'table',
        header: (block as TableBlock).header !== false,
        rows: Array.isArray(rows)
          ? rows.map((row) =>
              Array.isArray(row) ? row.map((cell) => normalizeRuns(cell)) : []
            )
          : []
      }
    }
    default:
      return null
  }
}

export function normalizeRuns(runs: unknown): Run[] {
  if (!Array.isArray(runs)) return []
  return runs
    .filter((r): r is Run => Boolean(r) && typeof (r as Run).text === 'string')
    .map((r) => ({ text: r.text, marks: Array.isArray(r.marks) ? r.marks : undefined }))
}
