/**
 * Declarative slash-command catalogue.
 *
 * This module is data only — the editor maps `id` to an action so the menu,
 * the toolbar and (potentially) the assistant all share one description of what
 * a command *is*. Keep it free of component imports.
 */

import { ICONS } from '$lib/icon-names'

export interface SlashCommand {
  id: string
  label: string
  icon: string
  keywords: string[]
  group: 'basic' | 'lists' | 'blocks' | 'data' | 'assistant'
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'text',
    label: 'Text',
    icon: ICONS.paragraph,
    keywords: ['paragraph', 'plain', 'body', 'text'],
    group: 'basic'
  },
  {
    id: 'h1',
    label: 'Heading 1',
    icon: ICONS.heading1,
    keywords: ['h1', 'title', 'large'],
    group: 'basic'
  },
  {
    id: 'h2',
    label: 'Heading 2',
    icon: ICONS.heading2,
    keywords: ['h2', 'subtitle', 'medium'],
    group: 'basic'
  },
  {
    id: 'h3',
    label: 'Heading 3',
    icon: ICONS.heading3,
    keywords: ['h3', 'small', 'section'],
    group: 'basic'
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    icon: ICONS.bulletList,
    keywords: ['bullet', 'unordered', 'list', 'ul'],
    group: 'lists'
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    icon: ICONS.list,
    keywords: ['numbered', 'ordered', 'list', 'ol'],
    group: 'lists'
  },
  {
    id: 'todo',
    label: 'To-do',
    icon: ICONS.checklist,
    keywords: ['todo', 'task', 'checkbox', 'check'],
    group: 'lists'
  },
  {
    id: 'quote',
    label: 'Quote',
    icon: ICONS.quote,
    keywords: ['quote', 'blockquote', 'citation'],
    group: 'blocks'
  },
  {
    id: 'callout-info',
    label: 'Callout',
    icon: ICONS.info,
    keywords: ['callout', 'note', 'info', 'tip'],
    group: 'blocks'
  },
  {
    id: 'callout-warning',
    label: 'Warning callout',
    icon: ICONS.warning,
    keywords: ['callout', 'warning', 'caution', 'alert'],
    group: 'blocks'
  },
  {
    id: 'code',
    label: 'Code',
    icon: ICONS.code,
    keywords: ['code', 'snippet', 'monospace', 'pre'],
    group: 'blocks'
  },
  {
    id: 'table',
    label: 'Table',
    icon: ICONS.table,
    keywords: ['table', 'grid', 'rows', 'columns'],
    group: 'blocks'
  },
  {
    id: 'divider',
    label: 'Divider',
    icon: ICONS.divider,
    keywords: ['divider', 'rule', 'separator', 'hr'],
    group: 'blocks'
  },
  {
    id: 'image',
    label: 'Image',
    icon: ICONS.image,
    keywords: ['image', 'picture', 'photo', 'media'],
    group: 'blocks'
  },
  {
    id: 'keyvalue',
    label: 'Key / value',
    icon: ICONS.key,
    keywords: ['key', 'value', 'properties', 'fields'],
    group: 'data'
  },
  {
    id: 'metric',
    label: 'Metric',
    icon: ICONS.chartLine,
    keywords: ['metric', 'kpi', 'number', 'stat'],
    group: 'data'
  },
  {
    id: 'table-data',
    label: 'Data table',
    icon: ICONS.dashboard,
    keywords: ['data', 'table', 'tracker', 'records'],
    group: 'data'
  },
  {
    id: 'form',
    label: 'Form',
    icon: ICONS.edit,
    keywords: ['form', 'input', 'capture', 'fields'],
    group: 'data'
  },
  {
    id: 'checklist',
    label: 'Checklist',
    icon: ICONS.success,
    keywords: ['checklist', 'tasks', 'progress'],
    group: 'data'
  },
  {
    id: 'page-redesign-architect',
    label: 'Redesign page with the architect',
    icon: ICONS.sparkles,
    keywords: ['redesign', 'architect', 'layout', 'restructure'],
    group: 'assistant'
  },
  {
    id: 'page-redesign-dashboard',
    label: 'Turn this into a dashboard',
    icon: ICONS.dashboard,
    keywords: ['dashboard', 'metrics', 'charts', 'overview'],
    group: 'assistant'
  }
]

/** Case-insensitive match over the label and keywords. Empty query = everything. */
export function filterCommands(query: string): SlashCommand[] {
  const needle = (query ?? '').trim().toLowerCase()
  if (needle.length === 0) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((command) => {
    if (command.label.toLowerCase().includes(needle)) return true
    return command.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  })
}
