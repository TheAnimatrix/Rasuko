/**
 * A small, dependency-free Markdown parser for assistant prose.
 *
 * Rasuko deliberately ships no Markdown library: content is never stored as
 * Markdown, and the assistant reply only needs the block and inline shapes
 * that actually appear in chat. This parses to a plain tree so the renderer
 * can stay declarative — no `{@html}` anywhere.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; inline: Inline[] }
  | { type: 'divider' }

function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  let i = 0

  const flush = (): void => {
    if (buffer) {
      out.push({ type: 'text', value: buffer })
      buffer = ''
    }
  }

  while (i < text.length) {
    const char = text[i]

    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ type: 'code', value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (char === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'strong', value: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }

    if (char === '*' && text[i + 1] !== ' ') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'em', value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (char === '[') {
      const close = text.indexOf(']', i + 1)
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2)
        if (paren > close) {
          flush()
          out.push({
            type: 'link',
            value: text.slice(i + 1, close),
            href: text.slice(close + 2, paren)
          })
          i = paren + 1
          continue
        }
      }
    }

    buffer += char
    i += 1
  }

  flush()
  return out
}

const FENCE = /^\s*```(\w*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const DIVIDER = /^\s*([-*_])\s*\1\s*\1[\s-*_]*$/

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || LIST.test(line) || DIVIDER.test(line)
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*$/.test(line)) {
      i += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const language = fence[1] ?? ''
      const code: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: 'code', language, code: code.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(3, heading[1].length) as 1 | 2 | 3,
        inline: parseInline(heading[2])
      })
      i += 1
      continue
    }

    if (DIVIDER.test(line)) {
      blocks.push({ type: 'divider' })
      i += 1
      continue
    }

    const quote = line.match(QUOTE)
    if (quote) {
      const quoteLines = [quote[1]]
      i += 1
      while (i < lines.length) {
        const next = lines[i].match(QUOTE)
        if (!next) break
        quoteLines.push(next[1])
        i += 1
      }
      blocks.push({ type: 'quote', inline: parseInline(quoteLines.join('\n')) })
      continue
    }

    const list = line.match(LIST)
    if (list) {
      const ordered = /\d/.test(list[2])
      const items: Inline[][] = []
      while (i < lines.length) {
        const next = lines[i].match(LIST)
        if (!next || /\d/.test(next[2]) !== ordered) break
        items.push(parseInline(next[3]))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph = [line]
    i += 1
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i])) {
      paragraph.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) })
  }

  return blocks
}
