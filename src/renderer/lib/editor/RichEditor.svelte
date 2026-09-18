<script lang="ts">
  /**
   * RichEditor — the single editing surface.
   *
   * Content is a `RichDoc`: an ordered array of ID-addressed blocks with inline
   * runs. Each block is its own `contenteditable`, which keeps stable ids,
   * partial bindings and diffing natural. Markdown is never stored — when
   * Markdown mode is on it is only an input affordance consumed on the
   * confirming keystroke.
   */

  import type { Block, CodeBlock, ListBlock, Mark, RichDoc, Run, TableBlock } from '@shared/richtext'
  import {
    blockHasRuns,
    emptyTable,
    normalizeDoc,
    paragraph,
    splitBlock,
    splitRuns,
    toggleMarkInRuns
  } from '@shared/richtext'
  import { newId } from '@shared/ids'
  import { onDestroy, tick, untrack } from 'svelte'
  import {
    applyInlineMarkdown,
    blockIndex,
    findBlock,
    indentBlock,
    markdownTransform,
    mergeRuns,
    moveBlock,
    rebuildRuns,
    removeBlock,
    runsToText,
    setBlockType,
    setCalloutTone,
    sliceRuns,
    textToRuns
  } from '$lib/editor/blockModel'
  import { blockToMarkdown } from '@shared/markdown'
  import { filterCommands, type SlashCommand } from '$lib/editor/commands'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { settingsStore, updateSettings } from '$lib/stores/settings.svelte'
  import { chat } from '$lib/stores/chat.svelte'
  import { cn, clamp } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import IconButton from '$lib/components/ui/IconButton.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Input from '$lib/components/ui/Input.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import Switch from '$lib/components/ui/Switch.svelte'
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import { ICONS } from '$lib/icon-names'

  interface Props {
    doc: RichDoc
    recordId: string
    projectId?: string
    blockIds?: readonly string[]
    viewId?: string
    nodeId?: string
    markdown?: boolean
    editable?: boolean
    placeholder?: string
    toolbar?: boolean
    showHandles?: boolean
    /**
     * Notepad mode: the toolbar stays available but only reveals itself on
     * hover, so a blank page looks blank until the writer reaches for it.
     */
    subtle?: boolean
    compact?: boolean
    class?: string
    blockClass?: string
    ondocchange?: (
      doc: RichDoc,
      target: {
        recordId: string
        projectId?: string
        blockIds: readonly string[]
        viewId?: string
        nodeId?: string
      }
    ) => void | Promise<void>
  }

  let {
    doc: docProp,
    recordId,
    projectId,
    blockIds = [],
    viewId,
    nodeId,
    markdown = false,
    editable = true,
    placeholder = '',
    toolbar = true,
    showHandles = true,
    subtle = false,
    compact = false,
    class: className,
    blockClass,
    ondocchange
  }: Props = $props()

  type TextBlock = Extract<Block, { runs: Run[] }>

  /* ------------------------------------------------------------------ *
   * Local document mirror
   * ------------------------------------------------------------------ */

  function serialize(value: RichDoc | null | undefined): string {
    try {
      return JSON.stringify(value ?? null)
    } catch {
      return ''
    }
  }

  let draft = $state<RichDoc>(normalizeDoc(untrack(() => docProp)))
  let lastSerialized = serialize(untrack(() => docProp))
  let dirty = false
  let dirtyVersion = 0
  let commitTimer: ReturnType<typeof setTimeout> | null = null
  let pendingCommit: Promise<void> | null = null
  const lastRuns = new Map<string, Run[]>()
  const blockEls = new Map<string, HTMLElement>()
  let commitTarget = untrack(() => ({
    projectId,
    recordId,
    blockIds: [...blockIds],
    blockKey: blockIds.join('\u0000'),
    viewId,
    nodeId,
    ondocchange
  }))

  let focusedId = $state<string | null>(null)
  let slash = $state<{ blockId: string; query: string; x: number; y: number; index: number } | null>(
    null
  )
  let bubble = $state<{ x: number; y: number; blockId: string; text: string } | null>(null)

  let imageOpen = $state(false)
  let imageBlockId = $state('')
  let imageUrl = $state('')

  let linkOpen = $state(false)
  let linkUrl = $state('')
  let linkTarget = $state<{ blockId: string; start: number; end: number } | null>(null)

  let reassignOpen = $state(false)
  let reassignBlockId = $state('')

  // Markdown only controls shorthand recognition. The structured editor stays
  // active in both modes.
  const markdownOn = $derived(Boolean(markdown))
  const spellcheck = $derived(settingsStore.value?.editor.spellcheck ?? true)

  /**
   * Cross-block selection.
   *
   * Each block is its own editing host, so the browser's native selection
   * cannot reliably span blocks. When a drag crosses from one block to another
   * we take over: the block range is tracked here, highlighted, and copy
   * serialises it. Dragging inside a single block is left to the browser, so
   * ordinary text selection is unchanged.
   */
  let blockSelection = $state<{
    anchorId: string
    anchorOffset: number
    focusId: string
    focusOffset: number
  } | null>(null)
  let pointerDragging = false
  let dragAnchorId: string | null = null
  let dragAnchorOffset = 0
  let rootEl = $state<HTMLElement | null>(null)

  const selectedBlockIds = $derived.by(() => {
    const sel = blockSelection
    if (!sel) return new Set<string>()
    const a = blockIndex(draft, sel.anchorId)
    const b = blockIndex(draft, sel.focusId)
    if (a < 0 || b < 0) return new Set<string>()
    const from = Math.min(a, b)
    const to = Math.max(a, b)
    return new Set(draft.blocks.slice(from, to + 1).map((block) => block.id))
  })

  // Adopt the incoming document whenever the store reports a change we did not
  // make ourselves. Comparing serialized content avoids adopting our own echo.
  $effect(() => {
    const incoming = docProp
    if (!incoming) return
    const nextBlockKey = blockIds.join('\u0000')
    if (
      recordId !== commitTarget.recordId ||
      projectId !== commitTarget.projectId ||
      nextBlockKey !== commitTarget.blockKey ||
      viewId !== commitTarget.viewId ||
      nodeId !== commitTarget.nodeId
    ) {
      flush()
      commitTarget = {
        projectId,
        recordId,
        blockIds: [...blockIds],
        blockKey: nextBlockKey,
        viewId,
        nodeId,
        ondocchange
      }
      lastSerialized = ''
    } else {
      commitTarget.ondocchange = ondocchange
    }
    // A refresh caused by another surface must not replace uncommitted typing,
    // including a snapshot restored to dirty state after a failed write.
    if (dirty || pendingCommit) return
    const key = serialize(incoming)
    if (key === lastSerialized) return
    lastSerialized = key
    draft = normalizeDoc(incoming)
    lastRuns.clear()
  })

  $effect(() => {
    const handler = (): void => onSelectionChange()
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  })

  $effect(() => {
    const handler = (event: ClipboardEvent): void => onCopy(event)
    document.addEventListener('copy', handler)
    return () => document.removeEventListener('copy', handler)
  })

  $effect(() => {
    const inside = (target: EventTarget | null): boolean =>
      Boolean(rootEl && target instanceof Node && rootEl.contains(target))
    const move = (event: MouseEvent): void => onDocumentMouseMove(event)
    const up = (): void => onDocumentMouseUp()
    const down = (event: MouseEvent): void => {
      if (blockSelection && !inside(event.target)) blockSelection = null
    }
    const selectStart = (event: Event): void => {
      if (blockSelection && inside(event.target)) event.preventDefault()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('mousedown', down)
    document.addEventListener('selectstart', selectStart)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('selectstart', selectStart)
    }
  })

  /* ------------------------------------------------------------------ *
   * Commit
   * ------------------------------------------------------------------ */

  function flush(): Promise<void> | undefined {
    if (commitTimer) {
      clearTimeout(commitTimer)
      commitTimer = null
    }
    if (!dirty) return pendingCommit ?? undefined
    dirty = false
    const version = dirtyVersion
    let snapshot: RichDoc
    try {
      snapshot = $state.snapshot(draft) as RichDoc
    } catch {
      snapshot = { type: 'doc', blocks: draft.blocks }
    }
    const serializedSnapshot = serialize(snapshot)
    const previousSerialized = lastSerialized
    lastSerialized = serializedSnapshot
    const target = { ...commitTarget, blockIds: [...commitTarget.blockIds] }
    const previous = pendingCommit
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      if (target.ondocchange) {
        await target.ondocchange(snapshot, target)
      } else {
        await workspace.updateRecord(target.recordId, { doc: snapshot }, target.projectId)
      }
    })
    pendingCommit = operation
    void operation.then(
      () => {
        if (pendingCommit === operation) pendingCommit = null
      },
      () => {
        // Retry the failed snapshot only when no later local edit superseded it.
        if (dirtyVersion === version && !dirty) {
          dirty = true
          if (lastSerialized === serializedSnapshot) lastSerialized = previousSerialized
        }
        if (pendingCommit === operation) pendingCommit = null
      }
    )
    return operation
  }

  $effect(() => {
    const handler = (event: Event): void => {
      const pending = flush()
      const detail = (event as CustomEvent<{ waitUntil?: (promise: Promise<unknown>) => void }>).detail
      if (pending && detail?.waitUntil) detail.waitUntil(pending)
    }
    window.addEventListener('rasuko:flush-editors', handler)
    return () => window.removeEventListener('rasuko:flush-editors', handler)
  })

  onDestroy(() => void flush())

  async function sendAfterFlush(text: string, mode: 'chat' | 'architect' = 'chat'): Promise<void> {
    await flush()
    await chat.send(text, mode)
  }

  function scheduleCommit(): void {
    if (commitTimer) clearTimeout(commitTimer)
    commitTimer = setTimeout(() => {
      commitTimer = null
      flush()
    }, 350)
  }

  function markDirty(): void {
    dirty = true
    dirtyVersion += 1
  }

  function setLocalBlock(id: string, next: Block): void {
    const index = blockIndex(draft, id)
    if (index < 0) return
    const blocks = draft.blocks.slice()
    blocks[index] = next
    draft = { type: 'doc', blocks }
    markDirty()
  }

  /* ------------------------------------------------------------------ *
   * Caret helpers
   * ------------------------------------------------------------------ */

  function caretOffset(el: HTMLElement): number {
    if (el instanceof HTMLTextAreaElement) return el.selectionStart ?? 0
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return 0
    const range = selection.getRangeAt(0)
    if (!el.contains(range.startContainer)) return 0
    const pre = range.cloneRange()
    pre.selectNodeContents(el)
    pre.setEnd(range.startContainer, range.startOffset)
    return pre.toString().length
  }

  function setCaret(el: HTMLElement, offset: number): void {
    if (el instanceof HTMLTextAreaElement) {
      el.focus()
      const at = clamp(offset, 0, el.value.length)
      el.setSelectionRange(at, at)
      return
    }
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    let remaining = Math.max(0, offset)
    let found = false
    const walk = (node: Node): void => {
      if (found) return
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0
        if (remaining <= length) {
          range.setStart(node, remaining)
          range.collapse(true)
          found = true
          return
        }
        remaining -= length
        return
      }
      for (const child of Array.from(node.childNodes)) {
        walk(child)
        if (found) return
      }
    }
    walk(el)
    if (!found) {
      range.selectNodeContents(el)
      range.collapse(false)
    }
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function caretRect(): DOMRect | null {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    try {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        const parent = range.startContainer.parentElement
        return parent ? parent.getBoundingClientRect() : null
      }
      return rect
    } catch {
      return null
    }
  }

  /* ------------------------------------------------------------------ *
   * DOM actions
   * ------------------------------------------------------------------ */

  function applyMarkClasses(node: HTMLElement, marks: Mark[]): void {
    const classes: string[] = []
    let link: string | null = null
    for (const mark of marks) {
      if (typeof mark === 'object') {
        if ('link' in mark) link = mark.link
        continue
      }
      switch (mark) {
        case 'bold':
          classes.push('font-semibold')
          break
        case 'italic':
          classes.push('italic')
          break
        case 'strike':
          classes.push('line-through')
          break
        case 'underline':
          classes.push('underline underline-offset-2')
          break
        case 'code':
          classes.push('rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]')
          break
        default:
          break
      }
    }
    if (link) classes.push('text-info underline underline-offset-2')
    node.className = classes.join(' ')
    if (link) node.dataset.link = link
  }

  function buildRuns(node: HTMLElement, runs: Run[]): void {
    const fragment = document.createDocumentFragment()
    for (const run of runs) {
      if (!run.text) continue
      if (!run.marks || run.marks.length === 0) {
        fragment.appendChild(document.createTextNode(run.text))
        continue
      }
      const span = document.createElement('span')
      applyMarkClasses(span, run.marks)
      span.textContent = run.text
      fragment.appendChild(span)
    }
    node.replaceChildren(fragment)
  }

  function registerBlock(node: HTMLElement, id: string) {
    blockEls.set(id, node)
    let current = id
    return {
      update(next: string): void {
        if (next === current) return
        blockEls.delete(current)
        current = next
        blockEls.set(current, node)
      },
      destroy(): void {
        blockEls.delete(current)
      }
    }
  }

  /** Renders runs into a contenteditable, guarding the focused element. */
  function syncRuns(node: HTMLElement, params: { key: string; runs: Run[] }) {
    let current = params.key
    const apply = (next: { key: string; runs: Run[] }): void => {
      if (next.key !== current) {
        current = next.key
        buildRuns(node, next.runs)
        return
      }
      if (document.activeElement === node) return
      buildRuns(node, next.runs)
    }
    apply(params)
    return { update: apply }
  }

  function syncTextarea(node: HTMLTextAreaElement, params: { key: string; text: string }) {
    let current = params.key
    const apply = (next: { key: string; text: string }): void => {
      if (next.key !== current) {
        current = next.key
        node.value = next.text
        return
      }
      if (document.activeElement === node) return
      if (node.value !== next.text) node.value = next.text
    }
    apply(params)
    return { update: apply }
  }

  function syncCell(node: HTMLElement, params: { key: string; text: string }) {
    let current = params.key
    const apply = (next: { key: string; text: string }): void => {
      if (next.key !== current) {
        current = next.key
        node.textContent = next.text
        return
      }
      if (document.activeElement === node) return
      if (node.textContent !== next.text) node.textContent = next.text
    }
    apply(params)
    return { update: apply }
  }

  /**
   * Focus a block after the DOM has settled.
   *
   * Changing a block's type swaps its element (a bullet or to-do renders an
   * extra control beside the editable), so writing the caret synchronously
   * targets a detached node and the writer loses focus mid-sentence.
   */
  function focusBlock(id: string, offset = 0): void {
    void tick().then(() => {
      const el = blockEls.get(id)
      if (!el) return
      setCaret(el, offset)
    })
  }

  function focusedBlockId(): string | null {
    const active = document.activeElement
    if (active) {
      for (const [id, el] of blockEls) {
        if (el === active || el.contains(active)) return id
      }
    }
    return focusedId ?? draft.blocks[0]?.id ?? null
  }

  function runsEqual(a: Run[], b: Run[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].text !== b[i].text) return false
      if (JSON.stringify(a[i].marks ?? []) !== JSON.stringify(b[i].marks ?? [])) return false
    }
    return true
  }

  /* ------------------------------------------------------------------ *
   * Input
   * ------------------------------------------------------------------ */

  function onInput(event: Event, block: Block): void {
    if (!editable) return
    const el = event.currentTarget as HTMLElement
    const text = el.textContent ?? ''
    const previous = lastRuns.get(block.id) ?? (blockHasRuns(block) ? block.runs : [])
    let runs = rebuildRuns(text, previous)
    let next: Block = blockHasRuns(block) ? ({ ...block, runs } as Block) : block

    if (markdownOn) {
      const transform = markdownTransform(text)
      if (transform) {
        const stripped = text.slice(transform.strip)
        let converted = setBlockType(next, transform.type, transform.level ?? 1)
        if (transform.type === 'callout') {
          converted = setCalloutTone(converted, transform.tone ?? 'info')
        }
        if (transform.type === 'code') {
          converted = { ...(converted as CodeBlock), text: stripped }
          lastRuns.set(block.id, [])
        } else if (transform.type === 'divider') {
          lastRuns.set(block.id, [])
        } else {
          const inline = applyInlineMarkdown(textToRuns(stripped))
          converted = blockHasRuns(converted) ? ({ ...converted, runs: inline } as Block) : converted
          lastRuns.set(block.id, inline)
          el.textContent = stripped
          // The block type just changed, so its element is about to be replaced.
          focusBlock(block.id, 0)
        }
        next = converted
      } else {
        const applied = applyInlineMarkdown(runs)
        if (!runsEqual(applied, runs)) {
          next = blockHasRuns(next) ? ({ ...next, runs: applied } as Block) : next
          buildRuns(el, applied)
          setCaret(el, runsToText(applied).length)
          lastRuns.set(block.id, applied)
          runs = applied
        } else {
          lastRuns.set(block.id, runs)
        }
      }
    } else {
      lastRuns.set(block.id, runs)
    }

    setLocalBlock(block.id, next)
    detectSlash(el, block.id)
    scheduleCommit()
  }

  function onCodeInput(id: string, event: Event): void {
    if (!editable) return
    const el = event.currentTarget as HTMLTextAreaElement
    const block = findBlock(draft, id)
    if (!block || block.type !== 'code') return
    setLocalBlock(id, { ...block, text: el.value })
    scheduleCommit()
  }

  function onBlur(blockId: string): void {
    const block = findBlock(draft, blockId)
    if (block && blockHasRuns(block)) lastRuns.set(blockId, block.runs)
    flush()
  }

  /* ------------------------------------------------------------------ *
   * Slash menu
   * ------------------------------------------------------------------ */

  const slashItems = $derived(slash ? filterCommands(slash.query) : [])

  const slashGroups = $derived.by(() => {
    const labels: Record<SlashCommand['group'], string> = {
      basic: 'Basic',
      lists: 'Lists',
      blocks: 'Blocks',
      data: 'Data',
      assistant: 'Assistant'
    }
    const order: SlashCommand['group'][] = ['basic', 'lists', 'blocks', 'data', 'assistant']
    const map = new Map<SlashCommand['group'], SlashCommand[]>()
    for (const command of slashItems) {
      const list = map.get(command.group) ?? []
      list.push(command)
      map.set(command.group, list)
    }
    return order
      .filter((group) => map.has(group))
      .map((group) => ({ label: labels[group], commands: map.get(group) ?? [] }))
  })

  function activeCommand(id: string): boolean {
    return slash ? slashItems[slash.index]?.id === id : false
  }

  function detectSlash(el: HTMLElement, blockId: string): void {
    if (!editable || el instanceof HTMLTextAreaElement) {
      slash = null
      return
    }
    const offset = caretOffset(el)
    const text = el.textContent ?? ''
    const before = text.slice(0, offset)
    const slashIndex = before.lastIndexOf('/')
    if (slashIndex < 0) {
      slash = null
      return
    }
    const query = before.slice(slashIndex + 1)
    if (/\s/.test(query)) {
      slash = null
      return
    }
    if (slashIndex > 0 && !/\s/.test(before[slashIndex - 1] ?? '')) {
      slash = null
      return
    }
    const rect = caretRect()
    const fallback = el.getBoundingClientRect()
    const x = clamp(rect?.left ?? fallback.left, 12, Math.max(12, window.innerWidth - 300))
    const y = clamp(
      rect ? rect.bottom + 6 : fallback.bottom + 6,
      12,
      Math.max(12, window.innerHeight - 64)
    )
    slash = { blockId, query, x, y, index: 0 }
  }

  async function runCommand(id: string): Promise<void> {
    const state = slash
    slash = null
    if (!state) return
    const block = findBlock(draft, state.blockId)
    if (!block) return
    const el = blockEls.get(state.blockId)
    let text =
      el && !(el instanceof HTMLTextAreaElement)
        ? el.textContent ?? ''
        : runsToText(blockHasRuns(block) ? block.runs : [])
    const offset = el ? caretOffset(el) : text.length
    let slashIndex = -1
    for (let i = Math.min(offset, text.length) - 1; i >= 0; i -= 1) {
      if (text[i] === '/') {
        slashIndex = i
        break
      }
      if (/\s/.test(text[i])) break
    }
    if (slashIndex >= 0) text = text.slice(0, slashIndex) + text.slice(offset)
    const base = blockHasRuns(block)
      ? ({ ...block, runs: rebuildRuns(text, block.runs) } as Block)
      : block

    switch (id) {
      case 'h1':
        setLocalBlock(block.id, setBlockType(base, 'heading', 1))
        break
      case 'h2':
        setLocalBlock(block.id, setBlockType(base, 'heading', 2))
        break
      case 'h3':
        setLocalBlock(block.id, setBlockType(base, 'heading', 3))
        break
      case 'bullet':
        setLocalBlock(block.id, setBlockType(base, 'bullet'))
        break
      case 'numbered':
        setLocalBlock(block.id, setBlockType(base, 'numbered'))
        break
      case 'todo':
        setLocalBlock(block.id, setBlockType(base, 'todo'))
        break
      case 'quote':
        setLocalBlock(block.id, setBlockType(base, 'quote'))
        break
      case 'callout-info':
        setLocalBlock(block.id, setCalloutTone(setBlockType(base, 'callout'), 'info'))
        break
      case 'callout-warning':
        setLocalBlock(block.id, setCalloutTone(setBlockType(base, 'callout'), 'warning'))
        break
      case 'code':
        setLocalBlock(block.id, setBlockType(base, 'code'))
        break
      case 'table':
        setLocalBlock(block.id, { ...emptyTable(3, 3), id: block.id })
        break
      case 'table-data':
        setLocalBlock(block.id, { ...emptyTable(4, 4), id: block.id })
        break
      case 'divider':
        setLocalBlock(block.id, { id: block.id, type: 'divider' })
        break
      case 'image':
        setLocalBlock(block.id, { id: block.id, type: 'image', src: '', alt: '' })
        imageBlockId = block.id
        imageUrl = ''
        imageOpen = true
        break
      case 'keyvalue':
        setLocalBlock(block.id, base)
        await sendAfterFlush('Add a key/value block here. Keep all existing content bound.')
        break
      case 'metric':
        setLocalBlock(block.id, base)
        await sendAfterFlush('Add a metric callout for this section. Keep all existing content bound.')
        break
      case 'form':
        setLocalBlock(block.id, base)
        await sendAfterFlush('Add a data-entry form for this section. Keep all existing content bound.')
        break
      case 'checklist':
        setLocalBlock(block.id, setBlockType(base, 'todo'))
        break
      case 'page-redesign-architect':
        setLocalBlock(block.id, base)
        await sendAfterFlush(
          'Redesign this page as a structured View. Keep all existing content bound.',
          'architect'
        )
        break
      case 'page-redesign-dashboard':
        setLocalBlock(block.id, base)
        await sendAfterFlush(
          'Turn this page into a dashboard with metrics and charts. Keep all existing content bound.',
          'architect'
        )
        break
      default:
        setLocalBlock(block.id, setBlockType(base, 'paragraph'))
    }
    flush()
    requestAnimationFrame(() => focusBlock(block.id, 0))
  }

  /* ------------------------------------------------------------------ *
   * Keyboard handling
   * ------------------------------------------------------------------ */

  function onKeydown(event: KeyboardEvent, block: Block): void {
    if (!editable) return

    if (blockSelection) {
      if (event.key === 'Escape') {
        event.preventDefault()
        blockSelection = null
        return
      }
      const editing =
        event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
      if (editing || event.key === 'Backspace' || event.key === 'Delete') {
        blockSelection = null
      }
    }

    if (slash && slash.blockId === block.id) {
      const items = slashItems
      if (event.key === 'ArrowDown' && items.length > 0) {
        event.preventDefault()
        slash = { ...slash, index: (slash.index + 1) % items.length }
        return
      }
      if (event.key === 'ArrowUp' && items.length > 0) {
        event.preventDefault()
        slash = { ...slash, index: (slash.index - 1 + items.length) % items.length }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const command = items[slash.index]
        if (command) void runCommand(command.id)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        slash = null
        return
      }
    }

    const el = event.currentTarget as HTMLElement

    if (event.key === 'Escape') {
      event.preventDefault()
      el.blur()
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      if (block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo') {
        applyIndent(block.id, event.shiftKey ? -1 : 1)
      }
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) softBreak(el, block)
      else splitAtCaret(el, block)
      return
    }

    if (event.key === 'Backspace') {
      if (caretOffset(el) === 0) {
        event.preventDefault()
        backspaceAtStart(block)
      }
      return
    }

    if (event.key === 'Delete') {
      const length =
        el instanceof HTMLTextAreaElement ? el.value.length : (el.textContent ?? '').length
      if (caretOffset(el) >= length) {
        event.preventDefault()
        deleteForward(block)
      }
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      handleVertical(event, block, el)
    }
  }

  function softBreak(el: HTMLElement, block: Block): void {
    if (!blockHasRuns(block)) return
    const offset = caretOffset(el)
    const previous = lastRuns.get(block.id) ?? block.runs
    const { before, after } = splitRuns(previous, offset)
    const runs = mergeRuns([...before, { text: '\n' }, ...after])
    setLocalBlock(block.id, { ...block, runs } as Block)
    buildRuns(el, runs)
    setCaret(el, offset + 1)
    lastRuns.set(block.id, runs)
    flush()
  }

  function splitAtCaret(el: HTMLElement, block: Block): void {
    if (!blockHasRuns(block)) return
    const text = el.textContent ?? ''
    const offset = caretOffset(el)
    const [left, right] = splitBlock(block, offset)
    const isList = block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo'
    if (isList && text.trim().length === 0) {
      setLocalBlock(block.id, setBlockType(block, 'paragraph'))
      flush()
      requestAnimationFrame(() => focusBlock(block.id, 0))
      return
    }
    let next: Block = right
    if (isList) {
      next = {
        ...(setBlockType(right, block.type) as ListBlock),
        indent: (block as ListBlock).indent ?? 0,
        ...(block.type === 'todo' ? { checked: false } : {})
      } as Block
    }
    const index = blockIndex(draft, block.id)
    if (index < 0) return
    const blocks = draft.blocks.slice()
    blocks.splice(index, 1, left, next)
    draft = { type: 'doc', blocks }
    markDirty()
    lastRuns.delete(block.id)
    lastRuns.delete(next.id)
    buildRuns(el, blockHasRuns(left) ? left.runs : [])
    flush()
    requestAnimationFrame(() => focusBlock(next.id, 0))
  }

  function backspaceAtStart(block: Block): void {
    if (block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo') {
      if ((block.indent ?? 0) > 0) {
        applyIndent(block.id, -1)
        return
      }
    }
    const index = blockIndex(draft, block.id)
    if (index <= 0) return
    let previousIndex = -1
    for (let i = index - 1; i >= 0; i -= 1) {
      if (blockHasRuns(draft.blocks[i])) {
        previousIndex = i
        break
      }
    }
    if (previousIndex < 0) return
    const previous = draft.blocks[previousIndex]
    if (!blockHasRuns(previous) || !blockHasRuns(block)) return
    const mergePoint = runsToText(previous.runs).length
    const merged = { ...previous, runs: mergeRuns([...previous.runs, ...block.runs]) } as Block
    const blocks = draft.blocks.slice()
    blocks.splice(index, 1)
    blocks[previousIndex] = merged
    draft = { type: 'doc', blocks }
    markDirty()
    lastRuns.delete(block.id)
    lastRuns.set(previous.id, blockHasRuns(merged) ? merged.runs : [])
    const el = blockEls.get(previous.id)
    if (el) buildRuns(el, blockHasRuns(merged) ? merged.runs : [])
    flush()
    requestAnimationFrame(() => focusBlock(previous.id, mergePoint))
  }

  function deleteForward(block: Block): void {
    const index = blockIndex(draft, block.id)
    if (index < 0 || index >= draft.blocks.length - 1) return
    const nextBlock = draft.blocks[index + 1]
    if (!blockHasRuns(nextBlock) || !blockHasRuns(block)) return
    const offset = runsToText(block.runs).length
    const merged = { ...block, runs: mergeRuns([...block.runs, ...nextBlock.runs]) } as Block
    const blocks = draft.blocks.slice()
    blocks.splice(index, 2, merged)
    draft = { type: 'doc', blocks }
    markDirty()
    lastRuns.delete(nextBlock.id)
    lastRuns.set(block.id, blockHasRuns(merged) ? merged.runs : [])
    const el = blockEls.get(block.id)
    if (el) {
      buildRuns(el, blockHasRuns(merged) ? merged.runs : [])
      setCaret(el, offset)
    }
    flush()
  }

  function applyIndent(id: string, delta: number): void {
    draft = indentBlock(draft, id, delta)
    markDirty()
    flush()
  }

  function handleVertical(event: KeyboardEvent, block: Block, el: HTMLElement): void {
    const rect = caretRect()
    if (!rect) return
    const blockRect = el.getBoundingClientRect()
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24
    const column = Math.max(0, rect.left - blockRect.left)
    if (event.key === 'ArrowUp' && rect.top <= blockRect.top + lineHeight * 0.6) {
      if (focusAdjacent(block, -1, column, true)) event.preventDefault()
      return
    }
    if (event.key === 'ArrowDown' && rect.bottom >= blockRect.bottom - lineHeight * 0.6) {
      if (focusAdjacent(block, 1, column, false)) event.preventDefault()
    }
  }

  function focusAdjacent(block: Block, direction: -1 | 1, column: number, toEnd: boolean): boolean {
    const index = blockIndex(draft, block.id)
    const target = draft.blocks[index + direction]
    if (!target) return false
    const targetEl = blockEls.get(target.id)
    if (!targetEl) return false
    if (target.type === 'code') {
      const area = targetEl as HTMLTextAreaElement
      area.focus()
      const caret = toEnd ? target.text.length : 0
      area.setSelectionRange(caret, caret)
      return true
    }
    if (!blockHasRuns(target)) return false
    focusAtColumn(target.id, column, toEnd)
    return true
  }

  function focusAtColumn(blockId: string, column: number, toEnd: boolean): void {
    const el = blockEls.get(blockId)
    if (!el) return
    el.focus()
    const length = (el.textContent ?? '').length
    if (toEnd && column <= 2) {
      setCaret(el, length)
      return
    }
    const baseLeft = el.getBoundingClientRect().left
    let best = toEnd ? length : 0
    let bestDelta = Infinity
    for (let offset = 0; offset <= length; offset += 1) {
      setCaret(el, offset)
      const rect = caretRect()
      if (!rect) continue
      const delta = Math.abs(rect.left - (baseLeft + column))
      if (delta <= bestDelta) {
        bestDelta = delta
        best = offset
      }
    }
    setCaret(el, best)
  }

  /* ------------------------------------------------------------------ *
   * Selection bubble
   * ------------------------------------------------------------------ */

  function selectionOffsets(blockId: string): { start: number; end: number } | null {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const el = blockEls.get(blockId)
    if (!el || el instanceof HTMLTextAreaElement) return null
    const range = selection.getRangeAt(0)
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null
    const preStart = document.createRange()
    preStart.selectNodeContents(el)
    preStart.setEnd(range.startContainer, range.startOffset)
    const start = preStart.toString().length
    const preEnd = document.createRange()
    preEnd.selectNodeContents(el)
    preEnd.setEnd(range.endContainer, range.endOffset)
    const end = preEnd.toString().length
    if (start === end) return null
    return { start: Math.min(start, end), end: Math.max(start, end) }
  }

  /**
   * Copy across several blocks.
   *
   * Each block is its own editing host, so a native copy only ever yields the
   * focused block. When the selection spans more than one block we serialise
   * every block it touches — clipping the first and last to the selection — to
   * Markdown, which keeps structure (headings, lists, to-dos, quotes) intact.
   * A selection inside a single block falls through to the browser so inline
   * formatting is preserved exactly.
   */
  function offsetWithin(el: HTMLElement, node: Node, offset: number): number {
    const range = document.createRange()
    range.selectNodeContents(el)
    try {
      range.setEnd(node, offset)
    } catch {
      return 0
    }
    return range.toString().length
  }

  function clipBlockStart(block: Block, offset: number): Block {
    if (block.type === 'code') return { ...block, text: block.text.slice(Math.max(0, offset)) }
    if (!blockHasRuns(block)) return block
    const { after } = splitRuns(block.runs, Math.max(0, offset))
    return { ...block, runs: after } as Block
  }

  function clipBlockEnd(block: Block, offset: number): Block {
    if (block.type === 'code') return { ...block, text: block.text.slice(0, Math.max(0, offset)) }
    if (!blockHasRuns(block)) return block
    const { before } = splitRuns(block.runs, Math.max(0, offset))
    return { ...block, runs: before } as Block
  }

  /** The tracked cross-block range, normalised so `start` precedes `end`. */
  function selectedRange(): {
    startIndex: number
    endIndex: number
    startOffset: number
    endOffset: number
  } | null {
    const sel = blockSelection
    if (!sel) return null
    const anchorIndex = blockIndex(draft, sel.anchorId)
    const focusIndex = blockIndex(draft, sel.focusId)
    if (anchorIndex < 0 || focusIndex < 0 || anchorIndex === focusIndex) return null
    return {
      startIndex: Math.min(anchorIndex, focusIndex),
      endIndex: Math.max(anchorIndex, focusIndex),
      startOffset: anchorIndex <= focusIndex ? sel.anchorOffset : sel.focusOffset,
      endOffset: anchorIndex <= focusIndex ? sel.focusOffset : sel.anchorOffset
    }
  }

  /** Serialise a block range to Markdown, clipping the first and last blocks. */
  function collectSelectionText(
    startIndex: number,
    endIndex: number,
    startOffset: number,
    endOffset: number
  ): string {
    const chunks: string[] = []
    for (let i = startIndex; i <= endIndex; i += 1) {
      let block = draft.blocks[i]
      if (i === startIndex) block = clipBlockStart(block, startOffset)
      if (i === endIndex) block = clipBlockEnd(block, endOffset)
      chunks.push(blockToMarkdown(block))
    }
    return chunks.join('\n\n')
  }

  function copyText(event: ClipboardEvent, text: string): void {
    if (!text.trim()) return
    event.clipboardData?.setData('text/plain', text)
    event.preventDefault()
  }

  function onCopy(event: ClipboardEvent): void {
    // 1) An explicit cross-block selection always wins.
    const tracked = selectedRange()
    if (tracked) {
      copyText(
        event,
        collectSelectionText(
          tracked.startIndex,
          tracked.endIndex,
          tracked.startOffset,
          tracked.endOffset
        )
      )
      return
    }

    // 2) Fall back to a native selection that happens to span editing hosts.
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    const startId = blockIdFromNode(range.startContainer)
    const endId = blockIdFromNode(range.endContainer)
    if (!startId || !endId || startId === endId) return
    const startIndex = blockIndex(draft, startId)
    const endIndex = blockIndex(draft, endId)
    if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return

    const forward = startIndex <= endIndex
    const firstBoundary = forward
      ? { node: range.startContainer, offset: range.startOffset }
      : { node: range.endContainer, offset: range.endOffset }
    const lastBoundary = forward
      ? { node: range.endContainer, offset: range.endOffset }
      : { node: range.startContainer, offset: range.startOffset }

    const from = Math.min(startIndex, endIndex)
    const to = Math.max(startIndex, endIndex)
    const chunks: string[] = []
    for (let i = from; i <= to; i += 1) {
      let block = draft.blocks[i]
      if (i === from) {
        const el = blockEls.get(block.id)
        if (el && !(el instanceof HTMLTextAreaElement)) {
          block = clipBlockStart(block, offsetWithin(el, firstBoundary.node, firstBoundary.offset))
        }
      }
      if (i === to) {
        const el = blockEls.get(block.id)
        if (el && !(el instanceof HTMLTextAreaElement)) {
          block = clipBlockEnd(block, offsetWithin(el, lastBoundary.node, lastBoundary.offset))
        }
      }
      chunks.push(blockToMarkdown(block))
    }
    copyText(event, chunks.join('\n\n'))
  }

  /* ------------------------------------------------------------------ *
   * Cross-block drag selection
   * ------------------------------------------------------------------ */

  function caretPoint(x: number, y: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    const range = doc.caretRangeFromPoint?.(x, y)
    if (range) return { node: range.startContainer, offset: range.startOffset }
    const position = doc.caretPositionFromPoint?.(x, y)
    if (position) return { node: position.offsetNode, offset: position.offset }
    return null
  }

  function offsetForPoint(x: number, y: number, id: string): number {
    const el = blockEls.get(id)
    if (!el || el instanceof HTMLTextAreaElement) return 0
    const point = caretPoint(x, y)
    if (point && el.contains(point.node)) return offsetWithin(el, point.node, point.offset)
    const rect = el.getBoundingClientRect()
    return y > rect.top + rect.height / 2 ? (el.textContent ?? '').length : 0
  }

  function onEditorMouseDown(event: MouseEvent): void {
    if (!editable || event.button !== 0) return
    if ((event.target as HTMLElement | null)?.closest('button, input, select, a')) return
    const id = blockIdFromNode(event.target as Node)
    if (!id || !findBlock(draft, id)) return
    if (blockSelection) blockSelection = null
    pointerDragging = true
    dragAnchorId = id
    dragAnchorOffset = offsetForPoint(event.clientX, event.clientY, id)
  }

  function onDocumentMouseMove(event: MouseEvent): void {
    if (!pointerDragging || !dragAnchorId) return
    const id = blockIdFromNode(document.elementFromPoint(event.clientX, event.clientY))
    if (!id || !findBlock(draft, id) || id === dragAnchorId) return
    if (blockIndex(draft, dragAnchorId) < 0) return
    blockSelection = {
      anchorId: dragAnchorId,
      anchorOffset: dragAnchorOffset,
      focusId: id,
      focusOffset: offsetForPoint(event.clientX, event.clientY, id)
    }
    window.getSelection()?.removeAllRanges()
    event.preventDefault()
  }

  function onDocumentMouseUp(): void {
    pointerDragging = false
    dragAnchorId = null
  }

  function blockIdFromNode(node: Node | null): string | null {
    let current: Node | null = node
    while (current) {
      if (current instanceof HTMLElement && current.dataset.blockId) {
        return current.dataset.blockId
      }
      current = current.parentNode
    }
    return null
  }

  function onSelectionChange(): void {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      bubble = null
      return
    }
    const text = selection.toString()
    if (!text.trim()) {
      bubble = null
      return
    }
    const range = selection.getRangeAt(0)
    const blockId = blockIdFromNode(range.commonAncestorContainer)
    if (!blockId) {
      bubble = null
      return
    }
    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      bubble = null
      return
    }
    bubble = {
      x: clamp(rect.left + rect.width / 2, 80, Math.max(80, window.innerWidth - 80)),
      y: Math.max(8, rect.top - 46),
      blockId,
      text
    }
  }

  function applySelectionMark(mark: Mark): void {
    const blockId = bubble?.blockId ?? focusedBlockId()
    if (!blockId) return
    const block = findBlock(draft, blockId)
    if (!block || !blockHasRuns(block)) return
    const range = selectionOffsets(blockId)
    const runs = range
      ? (() => {
          const { before, mid, after } = sliceRuns(block.runs, range.start, range.end)
          return mergeRuns([...before, ...toggleMarkInRuns(mid, mark), ...after])
        })()
      : toggleMarkInRuns(block.runs, mark)
    setLocalBlock(blockId, { ...block, runs })
    const el = blockEls.get(blockId)
    if (el) {
      buildRuns(el, runs)
      if (range) setCaret(el, range.end)
    }
    flush()
    bubble = null
  }

  function askAiSelection(): void {
    if (!bubble) return
    void sendAfterFlush(
      `Regarding this selection in block ${bubble.blockId} of record ${recordId}: "${bubble.text}"`
    )
    bubble = null
  }

  function openLinkDialog(): void {
    const blockId = bubble?.blockId ?? focusedBlockId()
    if (!blockId) return
    const block = findBlock(draft, blockId)
    if (!block || !blockHasRuns(block)) return
    const range = selectionOffsets(blockId)
    linkTarget = range
      ? { blockId, start: range.start, end: range.end }
      : { blockId, start: 0, end: runsToText(block.runs).length }
    linkUrl = ''
    linkOpen = true
  }

  function applyLink(): void {
    if (!linkTarget) return
    const block = findBlock(draft, linkTarget.blockId)
    if (!block || !blockHasRuns(block)) {
      linkOpen = false
      return
    }
    const url = linkUrl.trim()
    if (!url) {
      linkOpen = false
      return
    }
    const { before, mid, after } = sliceRuns(block.runs, linkTarget.start, linkTarget.end)
    const marked = toggleMarkInRuns(mid, { link: url })
    const runs = mergeRuns([...before, ...marked, ...after])
    setLocalBlock(linkTarget.blockId, { ...block, runs })
    const el = blockEls.get(linkTarget.blockId)
    if (el) {
      buildRuns(el, runs)
      setCaret(el, linkTarget.end)
    }
    linkOpen = false
    flush()
  }

  /* ------------------------------------------------------------------ *
   * Toolbar
   * ------------------------------------------------------------------ */

  const blockTypeOptions = [
    { value: 'paragraph', label: 'Text' },
    { value: 'h1', label: 'Heading 1' },
    { value: 'h2', label: 'Heading 2' },
    { value: 'h3', label: 'Heading 3' },
    { value: 'bullet', label: 'Bulleted list' },
    { value: 'numbered', label: 'Numbered list' },
    { value: 'todo', label: 'To-do' },
    { value: 'quote', label: 'Quote' },
    { value: 'callout', label: 'Callout' },
    { value: 'code', label: 'Code' }
  ]

  const turnIntoItems = [
    { id: 'paragraph', label: 'Paragraph', icon: ICONS.paragraph },
    { id: 'h1', label: 'Heading 1', icon: ICONS.heading1 },
    { id: 'h2', label: 'Heading 2', icon: ICONS.heading2 },
    { id: 'h3', label: 'Heading 3', icon: ICONS.heading3 },
    { id: 'bullet', label: 'Bulleted list', icon: ICONS.bulletList },
    { id: 'numbered', label: 'Numbered list', icon: ICONS.list },
    { id: 'todo', label: 'To-do', icon: ICONS.checklist },
    { id: 'quote', label: 'Quote', icon: ICONS.quote },
    { id: 'callout', label: 'Callout', icon: ICONS.info },
    { id: 'code', label: 'Code', icon: ICONS.code }
  ]

  const currentTurnValue = $derived.by(() => {
    const id = focusedId ?? draft.blocks[0]?.id ?? ''
    const block = findBlock(draft, id)
    if (!block) return 'paragraph'
    switch (block.type) {
      case 'heading':
        return `h${block.level}`
      case 'bullet':
        return 'bullet'
      case 'numbered':
        return 'numbered'
      case 'todo':
        return 'todo'
      case 'quote':
        return 'quote'
      case 'callout':
        return 'callout'
      case 'code':
        return 'code'
      default:
        return 'paragraph'
    }
  })

  function handleTurnChange(value: string): void {
    turnInto(focusedId, value)
  }

  function turnInto(blockId: string | null, value: string): void {
    const id = blockId ?? focusedBlockId()
    if (!id) return
    const block = findBlock(draft, id)
    if (!block) return
    switch (value) {
      case 'h1':
        setLocalBlock(id, setBlockType(block, 'heading', 1))
        break
      case 'h2':
        setLocalBlock(id, setBlockType(block, 'heading', 2))
        break
      case 'h3':
        setLocalBlock(id, setBlockType(block, 'heading', 3))
        break
      case 'bullet':
        setLocalBlock(id, setBlockType(block, 'bullet'))
        break
      case 'numbered':
        setLocalBlock(id, setBlockType(block, 'numbered'))
        break
      case 'todo':
        setLocalBlock(id, setBlockType(block, 'todo'))
        break
      case 'quote':
        setLocalBlock(id, setBlockType(block, 'quote'))
        break
      case 'callout':
        setLocalBlock(id, setBlockType(block, 'callout'))
        break
      case 'code':
        setLocalBlock(id, setBlockType(block, 'code'))
        break
      default:
        setLocalBlock(id, setBlockType(block, 'paragraph'))
    }
    flush()
    requestAnimationFrame(() => focusBlock(id, 0))
  }

  async function onToggleMarkdown(next: boolean): Promise<void> {
    const pageId = workspace.activePageId
    if (pageId) {
      await workspace.setPageMarkdown(pageId, next)
    } else {
      await updateSettings({ editor: { markdown: next } })
    }
  }

  /* ------------------------------------------------------------------ *
   * Block handles
   * ------------------------------------------------------------------ */

  function blockMenuItems() {
    return [
      { id: 'ask', label: 'Ask assistant about this block', icon: ICONS.sparkles },
      { id: 'reassign', label: 'Reassign / move content…', icon: ICONS.move },
      { id: 'extract', label: 'Extract to new block below', icon: ICONS.duplicate },
      { id: 'up', label: 'Move up', icon: ICONS.chevronUp, separatorBefore: true },
      { id: 'down', label: 'Move down', icon: ICONS.arrowDown },
      { id: 'copy-id', label: 'Copy block id', icon: ICONS.copy },
      { id: 'delete', label: 'Delete block', icon: ICONS.trash, danger: true, separatorBefore: true }
    ]
  }

  function onBlockMenu(action: string, block: Block): void {
    switch (action) {
      case 'ask':
        void sendAfterFlush(`Regarding block ${block.id} of record ${recordId}: `)
        break
      case 'reassign':
        reassignBlockId = block.id
        reassignOpen = true
        break
      case 'extract':
        extractBelow(block)
        break
      case 'up':
        move(block.id, -1)
        break
      case 'down':
        move(block.id, 1)
        break
      case 'copy-id':
        void navigator.clipboard?.writeText(block.id).catch(() => undefined)
        break
      case 'delete':
        deleteBlock(block.id)
        break
      default:
        break
    }
  }

  function move(id: string, delta: number): void {
    draft = moveBlock(draft, id, delta)
    markDirty()
    flush()
  }

  function extractBelow(block: Block): void {
    const index = blockIndex(draft, block.id)
    if (index < 0) return
    let copy: Block
    try {
      copy = JSON.parse(JSON.stringify($state.snapshot(block))) as Block
    } catch {
      copy = { ...block }
    }
    copy.id = newId('block')
    const blocks = draft.blocks.slice()
    blocks.splice(index + 1, 0, copy)
    draft = { type: 'doc', blocks }
    markDirty()
    flush()
  }

  function insertBelow(id: string): void {
    const index = blockIndex(draft, id)
    if (index < 0) return
    const fresh = paragraph()
    const blocks = draft.blocks.slice()
    blocks.splice(index + 1, 0, fresh)
    draft = { type: 'doc', blocks }
    markDirty()
    flush()
    requestAnimationFrame(() => focusBlock(fresh.id, 0))
  }

  function deleteBlock(id: string): void {
    draft = removeBlock(draft, id)
    markDirty()
    flush()
  }

  function setTone(id: string, tone: string): void {
    const block = findBlock(draft, id)
    if (!block || block.type !== 'callout') return
    const value = tone === 'success' || tone === 'warning' || tone === 'danger' ? tone : 'info'
    setLocalBlock(id, { ...block, tone: value })
    flush()
  }

  function toggleTodo(id: string): void {
    const block = findBlock(draft, id)
    if (!block || block.type !== 'todo') return
    setLocalBlock(id, { ...block, checked: !block.checked })
    flush()
  }

  function setCodeLanguage(id: string, language: string): void {
    const block = findBlock(draft, id)
    if (!block || block.type !== 'code') return
    setLocalBlock(id, { ...block, language })
    scheduleCommit()
  }

  function applyImageUrl(): void {
    const block = findBlock(draft, imageBlockId)
    if (block && block.type === 'image') {
      setLocalBlock(imageBlockId, { ...block, src: imageUrl.trim() })
      flush()
    }
    imageOpen = false
  }

  /* ------------------------------------------------------------------ *
   * Table cells
   * ------------------------------------------------------------------ */

  function setCell(blockId: string, row: number, col: number, text: string): void {
    const block = findBlock(draft, blockId)
    if (!block || block.type !== 'table') return
    const rows = block.rows.map((current, ri) =>
      ri === row ? current.map((cell, ci) => (ci === col ? textToRuns(text) : cell)) : current
    )
    setLocalBlock(blockId, { ...block, rows })
    scheduleCommit()
  }

  function addRow(blockId: string): void {
    const block = findBlock(draft, blockId)
    if (!block || block.type !== 'table') return
    const columns = Math.max(1, block.rows[0]?.length ?? 1)
    const rows = [...block.rows, Array.from({ length: columns }, () => [] as Run[])]
    setLocalBlock(blockId, { ...block, rows })
    flush()
  }

  function addColumn(blockId: string): void {
    const block = findBlock(draft, blockId)
    if (!block || block.type !== 'table') return
    const rows = block.rows.map((row) => [...row, [] as Run[]])
    setLocalBlock(blockId, { ...block, rows })
    flush()
  }

  function removeRow(blockId: string): void {
    const block = findBlock(draft, blockId)
    if (!block || block.type !== 'table' || block.rows.length <= 1) return
    setLocalBlock(blockId, { ...block, rows: block.rows.slice(0, -1) })
    flush()
  }

  function removeColumn(blockId: string): void {
    const block = findBlock(draft, blockId)
    if (!block || block.type !== 'table') return
    const columns = block.rows[0]?.length ?? 0
    if (columns <= 1) return
    const rows = block.rows.map((row) => row.slice(0, -1))
    setLocalBlock(blockId, { ...block, rows })
    flush()
  }

  /* ------------------------------------------------------------------ *
   * Reassign dialog
   * ------------------------------------------------------------------ */

  const reassignTargets = $derived.by(() => {
    if (!reassignBlockId) return []
    return draft.blocks
      .filter((block) => block.id !== reassignBlockId && blockHasRuns(block))
      .map((block) => ({
        id: block.id,
        text: runsToText((block as TextBlock).runs).slice(0, 60) || 'Empty block'
      }))
  })

  function confirmReassign(targetId: string): void {
    const source = findBlock(draft, reassignBlockId)
    const target = findBlock(draft, targetId)
    if (!source || !target || !blockHasRuns(source) || !blockHasRuns(target)) {
      reassignOpen = false
      return
    }
    const nextSource: Block = { ...source, runs: [] }
    const nextTarget: Block = { ...target, runs: mergeRuns([...target.runs, ...source.runs]) }
    const blocks = draft.blocks.map((block) =>
      block.id === source.id ? nextSource : block.id === target.id ? nextTarget : block
    )
    draft = { type: 'doc', blocks }
    markDirty()
    reassignOpen = false
    flush()
  }

  /* ------------------------------------------------------------------ *
   * List numbering + callout tones
   * ------------------------------------------------------------------ */

  const listNumbers = $derived.by(() => {
    const map = new Map<string, number>()
    let counter = 0
    for (const block of draft.blocks) {
      if (block.type === 'numbered') {
        counter += 1
        map.set(block.id, counter)
      } else if (block.type !== 'bullet' && block.type !== 'todo') {
        counter = 0
      }
    }
    return map
  })

  function listNumber(id: string): number {
    return listNumbers.get(id) ?? 1
  }

  function calloutToneClass(tone: string | undefined): string {
    switch (tone) {
      case 'danger':
        return 'border-destructive/25 bg-destructive/6 text-destructive'
      case 'warning':
        return 'border-warning/30 bg-warning/10 text-warning'
      case 'success':
        return 'border-success/25 bg-success/8 text-success'
      default:
        return 'border-info/25 bg-info/6 text-info'
    }
  }

  function calloutToneIcon(tone: string | undefined): string {
    switch (tone) {
      case 'danger':
        return 'close-circle-line'
      case 'warning':
        return 'warning-line'
      case 'success':
        return 'check-circle-line'
      default:
        return 'information-line'
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn('rich-editor group/editor relative', className)}
  onmousedown={onEditorMouseDown}
>
  {#if toolbar && editable && !compact}
    <div
      class={cn(
        'sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-1 px-0.5 py-1.5 transition-opacity',
        subtle
          ? 'opacity-0 focus-within:opacity-100 group-hover/editor:opacity-100'
          : 'border-b border-border/60 bg-background/85 backdrop-blur'
      )}
    >
      <Select
        class="w-[8.5rem]"
        value={currentTurnValue}
        options={blockTypeOptions}
        onchange={handleTurnChange}
        aria-label="Block type"
      />
      <DropdownMenu items={turnIntoItems} onselect={(id) => turnInto(focusedId, id)}>
        {#snippet trigger()}
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name={'transfer-line'} size={13} /> Turn into
          </button>
        {/snippet}
      </DropdownMenu>

      <span class="mx-0.5 h-4 w-px bg-border"></span>

      <IconButton icon={ICONS.bold} label="Bold" onclick={() => applySelectionMark('bold')} />
      <IconButton icon={ICONS.italic} label="Italic" onclick={() => applySelectionMark('italic')} />
      <IconButton icon={ICONS.underline} label="Underline" onclick={() => applySelectionMark('underline')} />
      <IconButton
        icon={ICONS.strikethrough}
        label="Strikethrough"
        onclick={() => applySelectionMark('strike')}
      />
      <IconButton icon={ICONS.inlineCode} label="Inline code" onclick={() => applySelectionMark('code')} />
      <IconButton icon={ICONS.link} label="Link" onclick={openLinkDialog} />

      <div class="ml-auto flex items-center gap-2 pr-1">
        <Tooltip
          content="Recognize Markdown shortcuts while typing. The editor always stores structured blocks."
          side="bottom"
        >
          <label class="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground">
            <Switch
              checked={markdownOn}
              onCheckedChange={onToggleMarkdown}
              aria-label="Markdown shortcuts"
            />
            Markdown shortcuts
          </label>
        </Tooltip>
      </div>
    </div>
  {/if}

  <div class={cn('flex flex-col', compact ? 'gap-0' : 'gap-0.5')}>
    {#each draft.blocks as block, index (block.id)}
      {@render blockRow(block, index)}
    {/each}
  </div>

  {#if slash && slashItems.length > 0}
    <div
      class="fixed z-50 w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style="left: {slash.x}px; top: {slash.y}px;"
    >
      <div class="max-h-72 overflow-y-auto">
        {#each slashGroups as group (group.label)}
          <div
            class="px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {group.label}
          </div>
          {#each group.commands as command (command.id)}
            <button
              type="button"
              class={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                activeCommand(command.id)
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              )}
              onmousedown={(event) => {
                event.preventDefault()
                void runCommand(command.id)
              }}
            >
              <Icon name={command.icon} size={15} class="text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{command.label}</span>
            </button>
          {/each}
        {/each}
      </div>
    </div>
  {/if}

  {#if bubble}
    <div
      class="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-0.5 text-popover-foreground shadow-lg"
      style="left: {bubble.x}px; top: {bubble.y}px; transform: translateX(-50%);"
    >
      <IconButton icon={ICONS.sparkles} label="Ask AI about this selection" onclick={askAiSelection} />
      <span class="mx-0.5 h-4 w-px bg-border"></span>
      <IconButton icon={ICONS.bold} label="Bold" onclick={() => applySelectionMark('bold')} />
      <IconButton icon={ICONS.italic} label="Italic" onclick={() => applySelectionMark('italic')} />
      <IconButton
        icon={ICONS.underline}
        label="Underline"
        onclick={() => applySelectionMark('underline')}
      />
      <IconButton
        icon={ICONS.strikethrough}
        label="Strikethrough"
        onclick={() => applySelectionMark('strike')}
      />
      <IconButton icon={ICONS.inlineCode} label="Inline code" onclick={() => applySelectionMark('code')} />
      <IconButton icon={ICONS.link} label="Link" onclick={openLinkDialog} />
      <DropdownMenu items={turnIntoItems} onselect={(id) => turnInto(bubble?.blockId ?? null, id)}>
        {#snippet trigger()}
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name={'transfer-line'} size={13} /> Turn into
          </button>
        {/snippet}
      </DropdownMenu>
    </div>
  {/if}
</div>

<Dialog
  bind:open={imageOpen}
  title="Image URL"
  description="Paste a URL to embed an image. Content stays in a structured block."
>
  <Input
    bind:value={imageUrl}
    placeholder="https://…"
    onkeydown={(event) => event.key === 'Enter' && applyImageUrl()}
  />
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (imageOpen = false)}>Cancel</Button>
    <Button onclick={applyImageUrl}>Insert image</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={linkOpen} title="Link" description="Wrap the selection in a hyperlink.">
  <Input
    bind:value={linkUrl}
    placeholder="https://…"
    onkeydown={(event) => event.key === 'Enter' && applyLink()}
  />
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (linkOpen = false)}>Cancel</Button>
    <Button onclick={applyLink}>Apply link</Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={reassignOpen}
  title="Reassign content"
  description="Move this block's text into another block. The target keeps its id; this block is emptied."
>
  <div class="max-h-72 space-y-0.5 overflow-y-auto">
    {#each reassignTargets as target (target.id)}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
        onclick={() => confirmReassign(target.id)}
      >
        <Icon name={ICONS.paragraph} size={14} class="text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">{target.text}</span>
      </button>
    {:else}
      <p class="px-2 py-6 text-center text-[12.5px] text-muted-foreground">
        No other text block to move into.
      </p>
    {/each}
  </div>
</Dialog>

{#snippet blockRow(block: Block, index: number)}
  <div
    class={cn(
      'group relative flex items-start gap-1 rounded-md transition-colors',
      selectedBlockIds.has(block.id) && 'bg-accent/25'
    )}
    data-block-id={block.id}
  >
    {#if editable && showHandles}
      <div
        class="mt-0.5 flex w-14 shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <button
          type="button"
          class="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Insert a block below"
          onclick={() => insertBelow(block.id)}
        >
          <Icon name={ICONS.add} size={13} />
        </button>
        <DropdownMenu items={blockMenuItems()} onselect={(id) => onBlockMenu(id, block)}>
          {#snippet trigger()}
            <button
              type="button"
              class="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Block actions"
            >
              <Icon name={ICONS.moreVertical} size={14} />
            </button>
          {/snippet}
        </DropdownMenu>
        {#if block.type === 'callout'}
          <select
            class="h-5 w-5 rounded border border-border bg-background text-[8px] text-muted-foreground"
            value={block.tone ?? 'info'}
            onchange={(event) => setTone(block.id, (event.currentTarget as HTMLSelectElement).value)}
            aria-label="Callout tone"
          >
            <option value="info">i</option>
            <option value="success">✓</option>
            <option value="warning">!</option>
            <option value="danger">!!</option>
          </select>
        {/if}
      </div>
    {/if}

    <div class="relative min-w-0 flex-1">
      {@render blockBody(block, index)}
    </div>
  </div>
{/snippet}

{#snippet blockBody(block: Block, index: number)}
  {#if block.type === 'paragraph'}
    {@render blockInput(block, 'text-[15px] leading-7')}
  {:else if block.type === 'heading'}
    {@render blockInput(
      block,
      block.level === 1
        ? 'text-2xl font-semibold tracking-tight leading-8'
        : block.level === 2
          ? 'text-xl font-semibold leading-7'
          : 'text-base font-semibold leading-6'
    )}
  {:else if block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo'}
    {@render listBlock(block, index)}
  {:else if block.type === 'quote'}
    <blockquote class="border-l-2 border-border pl-3 text-muted-foreground italic">
      {@render blockInput(block, 'text-[15px] leading-7')}
    </blockquote>
  {:else if block.type === 'callout'}
    <div
      class={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5',
        calloutToneClass(block.tone)
      )}
    >
      <Icon name={calloutToneIcon(block.tone)} size={15} class="mt-1" />
      <div class="min-w-0 flex-1">
        {@render blockInput(block, 'text-[14px] leading-6')}
      </div>
    </div>
  {:else if block.type === 'code'}
    {@render codeBlock(block)}
  {:else if block.type === 'divider'}
    <div class="group/divider flex items-center gap-2 py-1.5">
      <hr class="min-w-0 flex-1 border-border" />
      {#if editable}
        <IconButton
          icon={ICONS.trash}
          label="Delete divider"
          class="opacity-0 transition-opacity group-hover/divider:opacity-100"
          onclick={() => deleteBlock(block.id)}
        />
      {/if}
    </div>
  {:else if block.type === 'image'}
    <div class="group/image relative">
      {#if block.src}
        <img
          src={block.src}
          alt={block.alt ?? ''}
          class="max-h-80 w-full rounded-lg border border-border object-cover"
        />
        {#if editable}
          <div
            class="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover/image:opacity-100"
          >
            <IconButton
              icon={ICONS.edit}
              label="Change image URL"
              onclick={() => {
                imageBlockId = block.id
                imageUrl = block.src
                imageOpen = true
              }}
            />
          </div>
        {/if}
      {:else}
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-8 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent"
          onclick={() => {
            imageBlockId = block.id
            imageUrl = ''
            imageOpen = true
          }}
        >
          <Icon name={ICONS.image} size={16} />
          <span>Set image URL</span>
        </button>
      {/if}
    </div>
  {:else if block.type === 'table'}
    {@render tableBlock(block)}
  {/if}
{/snippet}

{#snippet blockInput(block: TextBlock, classes: string)}
  <div class="relative">
    <div
      use:registerBlock={block.id}
      use:syncRuns={{ key: block.id, runs: block.runs }}
      contenteditable={editable ? 'true' : 'false'}
      spellcheck={spellcheck}
      role="textbox"
      tabindex={editable ? 0 : -1}
      data-block-id={block.id}
      class={cn(
        'min-h-[1.4em] w-full outline-none whitespace-pre-wrap break-words',
        classes,
        blockClass
      )}
      oninput={(event) => onInput(event, block)}
      onkeydown={(event) => onKeydown(event, block)}
      onblur={() => onBlur(block.id)}
      onfocus={() => (focusedId = block.id)}
    ></div>
    {#if placeholder && runsToText(block.runs).length === 0 && focusedId !== block.id}
      <span
        class={cn(
          'pointer-events-none absolute left-0 top-0 select-none text-muted-foreground/50',
          classes
        )}
      >
        {placeholder}
      </span>
    {/if}
  </div>
{/snippet}

{#snippet listBlock(block: ListBlock, index: number)}
  <div class="flex items-start gap-2" style="margin-left: {(block.indent ?? 0) * 20}px">
    {#if block.type === 'todo'}
      <button
        type="button"
        class="mt-[5px] inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        aria-label={block.checked ? 'Mark as not done' : 'Mark as done'}
        onclick={() => toggleTodo(block.id)}
      >
        <Icon
          name={block.checked ? 'checkbox-fill' : 'checkbox-line'}
          size={16}
          class={block.checked ? 'text-success' : ''}
        />
      </button>
    {:else}
      <span class="mt-[3px] w-4 shrink-0 select-none text-right text-[13px] text-muted-foreground">
        {block.type === 'numbered' ? `${listNumber(block.id)}.` : '•'}
      </span>
    {/if}
    <div class="min-w-0 flex-1">
      {@render blockInput(
        block,
        block.checked ? 'text-[15px] leading-7 text-muted-foreground line-through' : 'text-[15px] leading-7'
      )}
    </div>
  </div>
{/snippet}

{#snippet codeBlock(block: CodeBlock)}
  <div class="overflow-hidden rounded-lg border border-border bg-secondary/40">
    <div class="flex items-center gap-2 border-b border-border px-2 py-1">
      <Icon name={ICONS.code} size={13} class="text-muted-foreground" />
      <input
        class="w-32 bg-transparent font-mono text-[11.5px] text-muted-foreground outline-none placeholder:text-muted-foreground/60"
        placeholder="language"
        value={block.language ?? ''}
        oninput={(event) =>
          setCodeLanguage(block.id, (event.currentTarget as HTMLInputElement).value)}
        aria-label="Code language"
      />
      {#if editable}
        <div class="ml-auto flex items-center gap-1">
          <IconButton
            icon={ICONS.copy}
            label="Copy code"
            onclick={() => void navigator.clipboard?.writeText(block.text).catch(() => undefined)}
          />
        </div>
      {/if}
    </div>
    <textarea
      use:registerBlock={block.id}
      use:syncTextarea={{ key: block.id, text: block.text }}
      class="block min-h-[3rem] w-full resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-foreground outline-none"
      rows={Math.min(20, Math.max(2, (block.text.match(/\n/g)?.length ?? 0) + 1))}
      spellcheck="false"
      readonly={!editable}
      oninput={(event) => onCodeInput(block.id, event)}
      aria-label="Code"
    ></textarea>
  </div>
{/snippet}

{#snippet tableBlock(block: TableBlock)}
  <div class="group/table rounded-lg border border-border">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[12.5px]">
        <tbody>
          {#each block.rows as row, rowIndex (rowIndex)}
            <tr class="border-b border-border last:border-0">
              {#each row as cell, cellIndex (cellIndex)}
                <td
                  class={cn(
                    'min-w-16 border-r border-border p-0 last:border-r-0',
                    block.header && rowIndex === 0 && 'bg-secondary/40 font-medium'
                  )}
                >
                  <div
                    use:syncCell={{
                      key: `${block.id}:${rowIndex}:${cellIndex}`,
                      text: runsToText(cell)
                    }}
                    contenteditable={editable ? 'true' : 'false'}
                    spellcheck={spellcheck}
                    class="min-h-7 px-2 py-1 outline-none whitespace-pre-wrap"
                    oninput={(event) =>
                      setCell(
                        block.id,
                        rowIndex,
                        cellIndex,
                        (event.currentTarget as HTMLElement).textContent ?? ''
                      )}
                  ></div>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if editable}
      <div
        class="flex flex-wrap items-center gap-1 border-t border-border px-1.5 py-1 opacity-0 transition-opacity group-hover/table:opacity-100 focus-within:opacity-100"
      >
        <IconButton icon={ICONS.add} label="Add row" onclick={() => addRow(block.id)} />
        <span class="text-[11px] text-muted-foreground">row</span>
        <IconButton icon={ICONS.add} label="Add column" onclick={() => addColumn(block.id)} />
        <span class="text-[11px] text-muted-foreground">column</span>
        <span class="mx-1 h-3.5 w-px bg-border"></span>
        <IconButton icon={ICONS.trash} label="Remove last row" onclick={() => removeRow(block.id)} />
        <IconButton icon={ICONS.close} label="Remove last column" onclick={() => removeColumn(block.id)} />
      </div>
    {/if}
  </div>
{/snippet}
