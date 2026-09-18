/**
 * Formatting helpers shared by the ported 21st.dev Agent Elements tool rows.
 * Mirrors `agent-elements/utils/format-tool.ts` from Mousse, narrowed to the
 * Rasuko tool surface.
 */

import type { ChatToolCall } from '@shared/types'

export function isPending(call: ChatToolCall): boolean {
  return !call.finishedAt
}

export function stringArg(input: Record<string, unknown> | undefined, key: string): string {
  const value = input?.[key]
  return typeof value === 'string' ? value : ''
}

export function basename(path: string): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function truncate(value: string, max = 64): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 3).trimEnd()}...`
}

/** Strip inline markdown so a one-line preview reads as prose. */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])(\*|_)([^*_]+)\2/g, '$1$3')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
}

/** First non-empty line of a thought, markdown stripped and truncated. */
export function thoughtHeading(content: string | undefined): string {
  if (!content) return ''
  const firstLine =
    content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const plain = stripInlineMarkdown(firstLine.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '')).trim()
  return truncate(plain, 64)
}

/**
 * Labels for a search row: always name the query, and only claim a result
 * count when the output actually carries one.
 */
export function searchRowLabels(
  toolLabel: string,
  query: string | undefined,
  totalResults: number | null
): { completeLabel: string; detail: string } {
  const cleanQuery = query?.trim()
  const detail = cleanQuery ? `${toolLabel} \u201C${cleanQuery}\u201D` : toolLabel
  if (totalResults && totalResults > 0) {
    return {
      completeLabel: `Found ${totalResults} ${totalResults === 1 ? 'match' : 'matches'}`,
      detail
    }
  }
  return { completeLabel: `No matches`, detail }
}

/** Best-effort count of greppy output lines ("path:line: text"). */
export function countGrepMatches(output: string | undefined): number | null {
  if (!output) return null
  if (output.trim() === 'No matches.') return 0
  return output.split('\n').filter((line) => /:\d+:/.test(line)).length
}
