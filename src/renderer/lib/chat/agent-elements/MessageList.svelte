<script lang="ts">
  /**
   * MessageList — 21st.dev Agent Elements.
   *
   * Owns the transcript: turn grouping, streaming follow, jump-to-latest, and
   * the scrollbar prompt dots. The composer stays app-owned (injected via the
   * `empty` snippet / rendered by the shell), exactly as Mousse does.
   */

  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { ChatMessage, ChatToolCall } from '@shared/types'
  import type { PendingTurn } from '$lib/stores/chat.svelte'
  import { ICONS } from '$lib/icon-names'
  import { cn } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import ToolRowBase from './ToolRowBase.svelte'
  import UserBubble from './UserBubble.svelte'
  import AssistantTurn from './AssistantTurn.svelte'
  import './agent-ui.css'

  interface Props {
    messages: ChatMessage[]
    pending?: PendingTurn | null
    showThinking?: boolean
    class?: string
    empty?: Snippet
    footer?: Snippet
  }

  let {
    messages,
    pending = null,
    showThinking = true,
    class: className,
    empty,
    footer
  }: Props = $props()

  const SCROLL_THRESHOLD = 80

  type AssistantEntry = {
    id: string
    text: string
    thinking?: string
    toolCalls: ChatToolCall[]
    error?: string
    createdAt?: string
    streaming: boolean
  }
  type Turn = { id: string; user?: ChatMessage; assistants: AssistantEntry[] }

  const turns = $derived.by<Turn[]>(() => {
    const out: Turn[] = []
    for (const message of messages) {
      if (message.role === 'user') {
        out.push({ id: message.id, user: message, assistants: [] })
        continue
      }
      if (message.role !== 'assistant') continue
      if (out.length === 0) out.push({ id: message.id, assistants: [] })
      out[out.length - 1].assistants.push({
        id: message.id,
        text: message.text,
        thinking: message.thinking,
        toolCalls: message.toolCalls ?? [],
        error: message.error,
        createdAt: message.createdAt,
        streaming: false
      })
    }
    const live = pending
    if (live) {
      const entry: AssistantEntry = {
        id: live.turnId,
        text: live.text,
        thinking: live.thinking,
        toolCalls: live.toolCalls,
        streaming: true
      }
      if (out.length === 0) out.push({ id: live.turnId, assistants: [entry] })
      else out[out.length - 1].assistants.push(entry)
    }
    return out
  })

  const showPlanning = $derived.by(() => {
    const live = pending
    if (!live) return false
    return !live.text.trim() && live.toolCalls.length === 0 && !live.thinking.trim()
  })

  let scrollEl = $state<HTMLDivElement | null>(null)
  let contentEl = $state<HTMLDivElement | null>(null)
  let pinned = $state(true)
  let markersVisible = $state(false)
  let markers = $state<{ id: string; ratio: number; preview: string }[]>([])
  let markerTimer: ReturnType<typeof setTimeout> | null = null
  let lastUserSeen: string | null = null

  function isAtBottom(): boolean {
    const element = scrollEl
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_THRESHOLD
  }

  function snapToBottom(): void {
    const element = scrollEl
    if (!element) return
    element.scrollTop = element.scrollHeight
  }

  function onScroll(): void {
    pinned = isAtBottom()
    revealMarkers()
  }

  function revealMarkers(): void {
    markersVisible = true
    if (markerTimer) clearTimeout(markerTimer)
    markerTimer = setTimeout(() => {
      markersVisible = false
      markerTimer = null
    }, 1200)
  }

  function onGutterMove(event: MouseEvent): void {
    const wrap = event.currentTarget as HTMLElement | null
    if (!wrap) return
    if (event.clientX >= wrap.getBoundingClientRect().right - 28) revealMarkers()
  }

  function escapeId(id: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id)
    return id.replace(/["\\]/g, '\\$&')
  }

  function updateMarkers(): void {
    const container = scrollEl
    const content = contentEl
    if (!container || !content) return
    const scrollHeight = container.scrollHeight
    if (!scrollHeight) return
    const containerRect = container.getBoundingClientRect()
    const next: { id: string; ratio: number; preview: string }[] = []
    for (const turn of turns) {
      if (!turn.user) continue
      const target = content.querySelector(`[data-prompt-id="${escapeId(turn.user.id)}"]`)
      if (!(target instanceof HTMLElement)) continue
      const y = target.getBoundingClientRect().top - containerRect.top + container.scrollTop
      next.push({
        id: turn.user.id,
        ratio: Math.min(0.995, Math.max(0, y / scrollHeight)),
        preview: turn.user.text.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Your prompt'
      })
    }
    markers = next
  }

  function scrollToPrompt(id: string): void {
    const container = scrollEl
    const content = contentEl
    if (!container || !content) return
    const target = content.querySelector(`[data-prompt-id="${escapeId(id)}"]`)
    if (!(target instanceof HTMLElement)) return
    const y =
      target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    pinned = false
    revealMarkers()
    container.scrollTo({ top: Math.max(0, y - 16), behavior: 'smooth' })
  }

  function jumpToLatest(): void {
    pinned = true
    const element = scrollEl
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }

  // A new prompt always re-pins the transcript to the bottom.
  $effect(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    const id = lastUser?.id ?? null
    if (id && id !== lastUserSeen) {
      lastUserSeen = id
      pinned = true
      requestAnimationFrame(snapToBottom)
    }
  })

  // Follow the live turn while pinned; never yank the viewport while reading.
  $effect(() => {
    void messages[messages.length - 1]
    void pending?.text
    void pending?.toolCalls.length
    if (!untrack(() => pinned)) return
    requestAnimationFrame(snapToBottom)
  })

  // Late layout (images, code, expanding cards) must not break the follow.
  $effect(() => {
    const content = contentEl
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (untrack(() => pinned)) snapToBottom()
      updateMarkers()
    })
    observer.observe(content)
    return () => observer.disconnect()
  })

  $effect(() => {
    void turns
    void contentEl
    void scrollEl
    requestAnimationFrame(updateMarkers)
  })
</script>

<div class={cn('relative flex min-h-0 flex-1 flex-col', className)}>
  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    onmousemove={onGutterMove}
    role="log"
    class="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
    aria-live="polite"
  >
    <div bind:this={contentEl} class="mx-auto w-full max-w-[520px] px-3.5 py-3">
      {#if turns.length === 0 && !pending}
        {@render empty?.()}
      {/if}

      <div class="space-y-5">
        {#each turns as turn, index (turn.id)}
          <div class="relative space-y-2.5">
            {#if turn.user}
              <div class="group/user-message" data-prompt-id={turn.user.id}>
                <UserBubble text={turn.user.text} />
              </div>
            {/if}

            {#each turn.assistants as entry (entry.id)}
              <AssistantTurn
                text={entry.text}
                thinking={entry.thinking}
                toolCalls={entry.toolCalls}
                error={entry.error}
                createdAt={entry.createdAt}
                streaming={entry.streaming}
                {showThinking}
              />
            {/each}

            {#if showPlanning && index === turns.length - 1}
              <ToolRowBase spinner shimmerLabel="Processing..." completeLabel="Done" isAnimating />
            {/if}
          </div>
        {/each}
      </div>

      {#if footer}
        <div class="mt-4 space-y-3">
          {@render footer?.()}
        </div>
      {/if}

      {#if pending}
        <div aria-hidden="true" class="min-h-[max(140px,24vh)] w-full"></div>
      {/if}
    </div>
  </div>

  {#if markers.length > 0}
    <div
      aria-hidden={!markersVisible}
      class={cn(
        'pointer-events-none absolute top-2 bottom-2 right-[4px] z-10 w-5 transition-opacity duration-200 ease-out',
        markersVisible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {#each markers as marker, index (marker.id)}
        <button
          type="button"
          tabindex="-1"
          title={`${index + 1}. ${marker.preview}`}
          aria-label={`Jump to prompt ${index + 1}: ${marker.preview}`}
          style="top: {marker.ratio * 100}%; background-color: var(--an-primary-color)"
          onclick={() => scrollToPrompt(marker.id)}
          onmouseenter={revealMarkers}
          class="pointer-events-auto absolute right-[3px] h-[14px] w-[5px] -translate-y-1/2 rounded-full opacity-55 shadow-[0_0_8px_color-mix(in_oklab,var(--an-primary-color)_70%,transparent)] transition-[transform,filter,opacity] duration-150 ease-out hover:w-[7px] hover:opacity-100 hover:brightness-125 active:scale-95"
        ></button>
      {/each}
    </div>
  {/if}

  {#if !pinned && turns.length > 0}
    <button
      type="button"
      onclick={jumpToLatest}
      aria-label="Jump to latest"
      class="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground py-1.5 pl-3 pr-3.5 text-[11.5px] font-medium text-background shadow-lg transition-[opacity,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.97]"
    >
      {#if pending}
        <span aria-hidden="true" class="size-1.5 animate-pulse rounded-full bg-current"></span>
      {/if}
      <Icon name={ICONS.arrowDown} size={13} />
      {pending ? 'Streaming — latest' : 'Latest'}
    </button>
  {/if}
</div>
