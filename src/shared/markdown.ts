/**
 * Markdown <-> RichDoc conversion.
 *
 * Markdown is a *view* of the content, never the storage. These functions exist
 * purely for the Markdown input mode, for pasting, and for export.
 *
 * The converter is intentionally conservative: it round-trips the block types
 * Rasuko stores and degrades gracefully on anything else, rather than depending
 * on a heavy third-party parser.
 */

import {
  type Block,
  type RichDoc,
  type Run,
  type Mark,
  emptyDoc,
  normalizeRuns
} from './richtext'
import { newId } from './ids'

/* ------------------------------------------------------------------ *
 * RichDoc -> Markdown
 * ------------------------------------------------------------------ */

function marksWrap(mark: Mark): { open: string; close: string } {
  if (typeof mark === 'object') {
    if ('link' in mark) return { open: '[', close: `](${mark.link})` }
    if ('color' in mark) return { open: '', close: '' }
  }
  switch (mark) {
    case 'bold':
      return { open: '**', close: '**' }
    case 'italic':
      return { open: '*', close: '*' }
    case 'strike':
      return { open: '~~', close: '~~' }
    case 'underline':
      return { open: '<u>', close: '</u>' }
    case 'code':
      return { open: '`', close: '`' }
    default:
      return { open: '', close: '' }
  }
}

export function runsToMarkdown(runs: Run[]): string {
  return runs
    .map((run) => {
      let text = run.text
      for (const mark of run.marks ?? []) {
        const { open, close } = marksWrap(mark)
        text = `${open}${text}${close}`
      }
      return text
    })
    .join('')
}

function tableToMarkdown(block: Extract<Block, { type: 'table' }>): string {
  if (block.rows.length === 0) return ''
  const lines: string[] = []
  const renderRow = (row: Run[][]) => `| ${row.map((c) => runsToMarkdown(c)).join(' | ')} |`
  lines.push(renderRow(block.rows[0]))
  if (block.header) {
    lines.push(`| ${block.rows[0].map(() => '---').join(' | ')} |`)
  }
  for (const row of block.rows.slice(1)) lines.push(renderRow(row))
  return lines.join('\n')
}

export function blockToMarkdown(block: Block, indent = 0): string {
  const pad = '  '.repeat(Math.max(0, indent))
  switch (block.type) {
    case 'paragraph':
      return `${pad}${runsToMarkdown(block.runs)}`
    case 'heading':
      return `${pad}${'#'.repeat(block.level)} ${runsToMarkdown(block.runs)}`
    case 'bullet':
      return `${pad}- ${runsToMarkdown(block.runs)}`
    case 'numbered':
      return `${pad}1. ${runsToMarkdown(block.runs)}`
    case 'todo':
      return `${pad}- [${block.checked ? 'x' : ' '}] ${runsToMarkdown(block.runs)}`
    case 'quote':
      return `${pad}> ${runsToMarkdown(block.runs)}`
    case 'code':
      return `${pad}\`\`\`${block.language ?? ''}\n${block.text}\n${pad}\`\`\``
    case 'callout':
      return `${pad}> [!${(block.tone ?? 'info').toUpperCase()}]\n${pad}> ${runsToMarkdown(block.runs)}`
    case 'divider':
      return `${pad}---`
    case 'image':
      return `${pad}![${block.alt ?? ''}](${block.src})`
    case 'table':
      return tableToMarkdown(block)
    default:
      return ''
  }
}

export function richDocToMarkdown(doc: RichDoc, separator = '\n\n'): string {
  return doc.blocks
    .map((block) => blockToMarkdown(block, block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo' ? (block as { indent?: number }).indent ?? 0 : 0))
    .join(separator)
}

/** Plain text projection — used for search, titles and previews. */
export function richDocToPlainText(doc: RichDoc): string {
  return doc.blocks
    .map((block) => {
      if (block.type === 'code') return block.text
      if (block.type === 'divider') return ''
      if (block.type === 'image') return block.alt ?? ''
      if (block.type === 'table') {
        return block.rows.map((r) => r.map((c) => c.map((x) => x.text).join('')).join(' | ')).join('\n')
      }
      return block.runs.map((r) => r.text).join('')
    })
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * Markdown -> RichDoc
 * ------------------------------------------------------------------ */

const INLINE_TOKEN = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\)|<u>[^<]*<\/u>)/g

export function markdownToRuns(input: string): Run[] {
  const runs: Run[] = []
  const push = (text: string, marks: Mark[] = []) => {
    if (text.length === 0) return
    if (marks.length === 0) {
      const last = runs[runs.length - 1]
      if (last && !last.marks) {
        last.text += text
        return
      }
      runs.push({ text })
      return
    }
    runs.push({ text, marks })
  }

  let cursor = 0
  for (const match of input.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0
    if (index > cursor) push(input.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('***') || token.startsWith('___')) {
      push(token.slice(3, -3), ['bold', 'italic'])
    } else if (token.startsWith('**') || token.startsWith('__')) {
      push(token.slice(2, -2), ['bold'])
    } else if (token.startsWith('~~')) {
      push(token.slice(2, -2), ['strike'])
    } else if (token.startsWith('*') || token.startsWith('_')) {
      push(token.slice(1, -1), ['italic'])
    } else if (token.startsWith('`')) {
      push(token.slice(1, -1), ['code'])
    } else if (token.startsWith('<u>')) {
      push(token.slice(3, -4), ['underline'])
    } else if (token.startsWith('[')) {
      const inner = token.slice(1)
      const close = inner.indexOf('](')
      const label = inner.slice(0, close)
      const url = inner.slice(close + 2, -1)
      push(label, [{ link: url }])
    }
    cursor = index + token.length
  }
  if (cursor < input.length) push(input.slice(cursor))
  return runs
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function markdownToRichDoc(markdown: string): RichDoc {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    // fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      const language = fence[1]
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ id: newId('block'), type: 'code', language: language || undefined, text: body.join('\n') })
      continue
    }

    // divider
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ id: newId('block'), type: 'divider' })
      i += 1
      continue
    }

    // heading
    const head = line.match(/^\s*(#{1,6})\s+(.*)$/)
    if (head) {
      const level = Math.min(3, head[1].length) as 1 | 2 | 3
      blocks.push({ id: newId('block'), type: 'heading', level, runs: markdownToRuns(head[2]) })
      i += 1
      continue
    }

    // table
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const header = splitTableRow(line).map(markdownToRuns)
      i += 2
      const rows: Run[][][] = [header]
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]).map(markdownToRuns))
        i += 1
      }
      blocks.push({ id: newId('block'), type: 'table', header: true, rows })
      continue
    }

    // callout
    const call = line.match(/^\s*>\s*\[!(\w+)\]\s*$/)
    if (call) {
      const tone = call[1].toLowerCase()
      const body: string[] = []
      i += 1
      while (i < lines.length && /^\s*>.+/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push({
        id: newId('block'),
        type: 'callout',
        tone: (['info', 'success', 'warning', 'danger'].includes(tone) ? tone : 'info') as
          | 'info'
          | 'success'
          | 'warning'
          | 'danger',
        runs: markdownToRuns(body.join(' '))
      })
      continue
    }

    // quote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push({ id: newId('block'), type: 'quote', runs: markdownToRuns(body.join(' ')) })
      continue
    }

    // task / bullet / numbered
    const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)
    if (task) {
      blocks.push({
        id: newId('block'),
        type: 'todo',
        checked: task[2].toLowerCase() === 'x',
        indent: Math.floor(task[1].length / 2),
        runs: markdownToRuns(task[3])
      })
      i += 1
      continue
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (bullet) {
      blocks.push({
        id: newId('block'),
        type: 'bullet',
        indent: Math.floor(bullet[1].length / 2),
        runs: markdownToRuns(bullet[2])
      })
      i += 1
      continue
    }
    const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/)
    if (numbered) {
      blocks.push({
        id: newId('block'),
        type: 'numbered',
        indent: Math.floor(numbered[1].length / 2),
        runs: markdownToRuns(numbered[2])
      })
      i += 1
      continue
    }

    // image-only paragraph
    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (image) {
      blocks.push({ id: newId('block'), type: 'image', alt: image[1], src: image[2] })
      i += 1
      continue
    }

    blocks.push({ id: newId('block'), type: 'paragraph', runs: markdownToRuns(line) })
    i += 1
  }

  return blocks.length > 0 ? { type: 'doc', blocks } : emptyDoc()
}

export { normalizeRuns }
