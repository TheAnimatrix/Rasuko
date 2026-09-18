import type { ChatMessage, ContentRecord, Conversation, ConversationSummary, ViewDoc } from '@shared/types'
import type { ChatStreamEvent } from '@shared/ipc'
import { newId } from '@shared/ids'
import { workspace } from '$lib/stores/workspace.svelte'

export interface PendingTurn {
  turnId: string
  text: string
  thinking: string
  toolCalls: NonNullable<ChatMessage['toolCalls']>
  pageId: string
  conversationId: string
}

export interface ReattachSuggestion {
  recordId: string
  label: string
  kind: ContentRecord['kind']
  targetNodeId?: string
}

/**
 * Assistant state for the active page.
 *
 * Streaming text is held separately from the persisted history so a turn can be
 * rendered token-by-token without rewriting the transcript on every delta.
 */
class ChatState {
  messages = $state<ChatMessage[]>([])
  pending = $state<PendingTurn | null>(null)
  loading = $state(false)
  error = $state<string | null>(null)
  lastReceipt = $state<import('@shared/types').OpReceipt | null>(null)
  suggestions = $state<ReattachSuggestion[]>([])
  sessions = $state<ConversationSummary[]>([])
  conversationId = $state<string | null>(null)
  #unsubscribe: (() => void) | null = null
  #pageId: string | null = null
  #attachRevision = 0
  #sessionRevision = 0
  #inFlightPages = new Set<string>()
  #pendingByPage = new Map<string, PendingTurn>()
  #finishedByConversation = new Map<string, ChatMessage>()
  #receiptsByConversation = new Map<string, import('@shared/types').OpReceipt>()

  get isStreaming(): boolean {
    return this.pending !== null
  }

  async attach(pageId: string): Promise<void> {
    if (this.#pageId === pageId && this.conversationId) return
    const revision = ++this.#attachRevision
    ++this.#sessionRevision
    this.#pageId = pageId
    this.conversationId = null
    this.pending = null
    this.messages = []
    this.sessions = []
    this.loading = true
    this.error = null
    this.lastReceipt = null
    this.suggestions = []
    if (!this.#unsubscribe) {
      this.#unsubscribe = window.rasuko.chat.onEvent((event) => this.handleEvent(event))
    }

    try {
      const [conversation, sessions] = await Promise.all([
        window.rasuko.chat.current(pageId),
        window.rasuko.chat.list(pageId)
      ])
      if (revision !== this.#attachRevision || this.#pageId !== pageId) return
      this.applyConversation(conversation)
      this.sessions = sessions
      this.loading = this.#inFlightPages.has(pageId)
    } catch (error) {
      if (revision !== this.#attachRevision || this.#pageId !== pageId) return
      this.loading = false
      this.error = error instanceof Error ? error.message : 'Could not load chat history.'
    }
  }

  private handleEvent(event: ChatStreamEvent): void {
    // Keep receiving the originating page's turn while another page is open.
    // Reattaching restores this draft, including the ability to stop it.
    let draft = this.#pendingByPage.get(event.pageId)
    if (event.type !== 'turn_start' && draft?.turnId !== event.turnId) return
    const visible = event.pageId === this.#pageId && event.conversationId === this.conversationId
    switch (event.type) {
      case 'turn_start':
        draft = {
          turnId: event.turnId,
          text: '',
          thinking: '',
          toolCalls: [],
          pageId: event.pageId,
          conversationId: event.conversationId
        }
        if (visible) this.error = null
        break
      case 'text_delta':
        if (draft) draft = { ...draft, text: draft.text + event.delta }
        break
      case 'thinking_delta':
        if (draft) draft = { ...draft, thinking: draft.thinking + event.delta }
        break
      case 'tool_start':
        if (draft) {
          draft = { ...draft, toolCalls: [...draft.toolCalls, {
            id: event.id,
            name: event.name,
            input: event.input,
            startedAt: new Date().toISOString()
          }] }
        }
        break
      case 'tool_end':
        if (draft) {
          draft = { ...draft, toolCalls: draft.toolCalls.map((call) => call.id === event.id
            ? { ...call, output: event.output, isError: event.isError, finishedAt: new Date().toISOString() }
            : call) }
        }
        break
      case 'view_ops':
        this.#receiptsByConversation.set(event.conversationId, event.receipt)
        if (visible) this.lastReceipt = event.receipt
        // Show the redesign as soon as the ops land, not at the end of the turn.
        if (event.pageId === workspace.activePageId) void workspace.refreshPayload()
        break
      case 'notice':
        break
      case 'error':
        if (visible) this.error = event.message
        break
      case 'turn_end':
        draft = undefined
        this.#finishedByConversation.set(event.conversationId, event.message)
        if (visible && !this.messages.some((m) => m.id === event.message.id)) {
          this.messages = [...this.messages, event.message]
        }
        // The assistant mutates the workspace in the main process. Re-read the
        // page so a redesign lands on screen even if a broadcast was missed.
        if (event.pageId === workspace.activePageId) void workspace.refreshPayload()
        break
      default:
        break
    }
    if (draft) this.#pendingByPage.set(event.pageId, draft)
    else this.#pendingByPage.delete(event.pageId)
    if (visible) this.pending = draft ?? null
  }

  async send(text: string, mode: 'chat' | 'architect' = 'chat'): Promise<void> {
    const pageId = this.#pageId
    const conversationId = this.conversationId
    const trimmed = text.trim()
    if (!pageId || !conversationId || !trimmed || this.isStreaming || this.loading || this.#inFlightPages.has(pageId)) return
    this.loading = true
    this.#inFlightPages.add(pageId)
    this.error = null
    // Surface the prompt immediately. The main process returns only the finished
    // assistant turn, so without this the user's own message never appears in
    // the transcript until the conversation is re-attached.
    const prompt: ChatMessage = {
      id: newId('message'),
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString()
    }
    try {
      const writes: Promise<unknown>[] = []
      window.dispatchEvent(new CustomEvent('rasuko:flush-editors', {
        detail: { waitUntil: (write: Promise<unknown>) => writes.push(write) }
      }))
      await Promise.all(writes)
      if (this.#pageId !== pageId || this.conversationId !== conversationId) return
      this.messages = [...this.messages, prompt]
      const message = await window.rasuko.chat.send({ pageId, text: trimmed, mode })
      if (this.#pageId !== pageId || this.conversationId !== conversationId) return
      if (!this.messages.some((m) => m.id === message.id)) {
        this.messages = [...this.messages, message]
      }
      // Replace the optimistic prompt with its persisted ID so reopening this
      // session has exactly the same transcript as the currently visible one.
      await this.refreshConversation(pageId, conversationId)
      await this.refreshSessions(pageId, conversationId)
    } catch (error) {
      if (this.#pageId === pageId && this.conversationId === conversationId) {
        this.messages = this.messages.filter((message) => message.id !== prompt.id)
        await this.refreshConversation(pageId, conversationId).catch(() => undefined)
        if (this.#pageId === pageId && this.conversationId === conversationId) {
          this.error = error instanceof Error ? error.message : 'The assistant failed.'
        }
      }
    } finally {
      if (this.#pageId === pageId && this.conversationId === conversationId) {
        this.loading = false
        this.pending = null
      }
      this.#inFlightPages.delete(pageId)
    }
  }

  async abort(): Promise<void> {
    if (!this.#pageId) return
    await window.rasuko.chat.abort(this.#pageId)
  }

  async clear(): Promise<void> {
    await this.newChat()
  }

  async newChat(): Promise<void> {
    const pageId = this.#pageId
    if (!pageId || this.isStreaming || this.loading) return
    const revision = ++this.#sessionRevision
    this.loading = true
    this.error = null
    try {
      const conversation = await window.rasuko.chat.create(pageId)
      if (revision !== this.#sessionRevision || this.#pageId !== pageId) return
      this.applyConversation(conversation)
      await this.refreshSessions(pageId, conversation.id)
    } catch (error) {
      if (revision === this.#sessionRevision && this.#pageId === pageId) {
        this.error = error instanceof Error ? error.message : 'Could not start a new chat.'
      }
    } finally {
      if (revision === this.#sessionRevision && this.#pageId === pageId) this.loading = false
    }
  }

  async selectConversation(conversationId: string): Promise<void> {
    const pageId = this.#pageId
    if (!pageId || this.isStreaming || this.loading || conversationId === this.conversationId) return
    const revision = ++this.#sessionRevision
    this.loading = true
    this.error = null
    try {
      const conversation = await window.rasuko.chat.select(pageId, conversationId)
      if (revision !== this.#sessionRevision || this.#pageId !== pageId || conversation.id !== conversationId) return
      this.applyConversation(conversation)
      await this.refreshSessions(pageId, conversation.id)
    } catch (error) {
      if (revision === this.#sessionRevision && this.#pageId === pageId) {
        this.error = error instanceof Error ? error.message : 'Could not open that chat.'
      }
    } finally {
      if (revision === this.#sessionRevision && this.#pageId === pageId) this.loading = false
    }
  }

  private applyConversation(conversation: Conversation): void {
    this.conversationId = conversation.id
    this.messages = conversation.messages
    const finished = this.#finishedByConversation.get(conversation.id)
    if (finished && !this.messages.some((message) => message.id === finished.id)) {
      this.messages = [...this.messages, finished]
    }
    const draft = this.#pendingByPage.get(conversation.pageId)
    this.pending = draft?.conversationId === conversation.id ? draft : null
    this.loading = false
    this.error = null
    this.lastReceipt = this.#receiptsByConversation.get(conversation.id) ?? null
  }

  private async refreshConversation(pageId: string, conversationId: string): Promise<void> {
    const conversation = await window.rasuko.chat.current(pageId)
    if (this.#pageId === pageId && this.conversationId === conversationId && conversation.id === conversationId) {
      const loading = this.loading
      this.applyConversation(conversation)
      this.loading = loading
    }
  }

  private async refreshSessions(pageId: string, conversationId: string): Promise<void> {
    const sessions = await window.rasuko.chat.list(pageId)
    if (this.#pageId === pageId && this.conversationId === conversationId) this.sessions = sessions
  }

  /** Content that a redesign left unplaced — surfaced for reattachment. */
  syncSuggestions(view: ViewDoc | null, records: Record<string, ContentRecord>): void {
    const bound = new Set<string>()
    const walk = (node: ViewDoc['root']) => {
      if (node.bind?.recordId) bound.add(node.bind.recordId)
      for (const child of node.children ?? []) walk(child)
    }
    if (view) walk(view.root)
    this.suggestions = Object.values(records)
      .filter((record) => !bound.has(record.id))
      .map((record) => ({
        recordId: record.id,
        label: record.label ?? record.kind,
        kind: record.kind
      }))
  }
}

export const chat = new ChatState()
