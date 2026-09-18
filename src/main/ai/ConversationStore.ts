import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ConversationSummary } from '@shared/types'
import { newId, nowIso } from '@shared/ids'
import { projectDir } from '../paths'
import { atomicWriteJsonSync, ensureDir, readJsonSync } from '../io/atomic'
import type { WorkspaceStore } from '../workspace/WorkspaceStore'

interface ConversationIndex {
  version: 1
  pageId: string
  activeConversationId: string
  conversationIds: string[]
}

/** Durable, per-page chat sessions with migration from the original single file. */
export class ConversationStore {
  constructor(private readonly workspace: WorkspaceStore) {}

  getActive(pageId: string): Conversation {
    const index = this.ensureIndex(pageId)
    const active = this.readConversation(pageId, index.activeConversationId)
    if (active) return active

    const fallback = index.conversationIds
      .map((id) => this.readConversation(pageId, id))
      .find((conversation): conversation is Conversation => Boolean(conversation))
    if (fallback) {
      this.writeIndex(pageId, { ...index, activeConversationId: fallback.id })
      return fallback
    }
    return this.create(pageId)
  }

  list(pageId: string): ConversationSummary[] {
    const index = this.ensureIndex(pageId)
    return index.conversationIds
      .map((id) => this.readConversation(pageId, id))
      .filter((conversation): conversation is Conversation => Boolean(conversation))
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  create(pageId: string): Conversation {
    this.assertPageId(pageId)
    this.projectId(pageId)
    const hasExisting = Boolean(
      this.readIndex(pageId) || this.discoverConversationIds(pageId).length > 0 || this.readLegacy(pageId)
    )
    if (!hasExisting) return this.createFresh(pageId)
    const existing = this.ensureIndex(pageId)
    return this.createFresh(pageId, existing)
  }

  private createFresh(pageId: string, existing?: ConversationIndex): Conversation {
    const now = nowIso()
    const conversation: Conversation = {
      id: newId('chat'),
      pageId,
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    this.writeConversation(conversation)
    this.writeIndex(pageId, {
      version: 1,
      pageId,
      activeConversationId: conversation.id,
      conversationIds: uniqueIds([conversation.id, ...(existing?.conversationIds ?? [])])
    })
    return conversation
  }

  select(pageId: string, conversationId: string): Conversation {
    this.assertPageId(pageId)
    this.assertConversationId(conversationId)
    const index = this.ensureIndex(pageId)
    if (!index.conversationIds.includes(conversationId)) {
      throw new Error('Conversation does not belong to this page')
    }
    const conversation = this.readConversation(pageId, conversationId)
    if (!conversation) throw new Error('Conversation not found')
    this.writeIndex(pageId, { ...index, activeConversationId: conversationId })
    return conversation
  }

  persist(conversation: Conversation): void {
    this.assertPageId(conversation.pageId)
    this.assertConversationId(conversation.id)
    this.projectId(conversation.pageId)
    const normalized = normalizeConversation(conversation, conversation.pageId)
    normalized.updatedAt = nowIso()
    normalized.title = deriveTitle(normalized)
    if (!normalized.createdAt) normalized.createdAt = normalized.updatedAt
    Object.assign(conversation, normalized)
    this.writeConversation(normalized)

    const index = this.readIndex(conversation.pageId)
    this.writeIndex(conversation.pageId, {
      version: 1,
      pageId: conversation.pageId,
      activeConversationId: index?.activeConversationId || conversation.id,
      conversationIds: uniqueIds([conversation.id, ...(index?.conversationIds ?? [])])
    })
  }

  private ensureIndex(pageId: string): ConversationIndex {
    this.assertPageId(pageId)
    this.projectId(pageId)
    const existing = this.readIndex(pageId)
    if (existing) return existing

    const discovered = this.discoverConversationIds(pageId)
    if (discovered.length > 0) {
      const legacy = this.readLegacy(pageId)
      if (legacy && !discovered.includes(legacy.id)) {
        this.writeConversation(legacy)
        discovered.push(legacy.id)
      }
      const index: ConversationIndex = {
        version: 1,
        pageId,
        activeConversationId: discovered[0],
        conversationIds: discovered
      }
      this.writeIndex(pageId, index)
      return index
    }

    const legacy = this.readLegacy(pageId)
    if (legacy) {
      this.writeConversation(legacy)
      const index: ConversationIndex = {
        version: 1,
        pageId,
        activeConversationId: legacy.id,
        conversationIds: [legacy.id]
      }
      this.writeIndex(pageId, index)
      return index
    }

    const created = this.createFresh(pageId)
    return {
      version: 1,
      pageId,
      activeConversationId: created.id,
      conversationIds: [created.id]
    }
  }

  private readLegacy(pageId: string): Conversation | null {
    const raw = readJsonSync<unknown>(this.legacyPath(pageId))
    if (!raw || typeof raw !== 'object') return null
    const candidate = raw as Partial<Conversation>
    if (!Array.isArray(candidate.messages)) return null
    const id = isSafeConversationId(candidate.id) ? candidate.id : newId('chat')
    return normalizeConversation({ ...candidate, id } as Conversation, pageId)
  }

  private readConversation(pageId: string, conversationId: string): Conversation | null {
    this.assertConversationId(conversationId)
    const raw = readJsonSync<unknown>(this.conversationPath(pageId, conversationId))
    if (!raw || typeof raw !== 'object') return null
    const candidate = raw as Partial<Conversation>
    if (candidate.id !== conversationId || candidate.pageId !== pageId || !Array.isArray(candidate.messages)) {
      return null
    }
    return normalizeConversation(candidate as Conversation, pageId)
  }

  private writeConversation(conversation: Conversation): void {
    ensureDir(this.pageChatDir(conversation.pageId))
    atomicWriteJsonSync(this.conversationPath(conversation.pageId, conversation.id), conversation)
  }

  private readIndex(pageId: string): ConversationIndex | null {
    const raw = readJsonSync<unknown>(this.indexPath(pageId))
    if (!raw || typeof raw !== 'object') return null
    const input = raw as Partial<ConversationIndex>
    const ids = uniqueIds(
      (Array.isArray(input.conversationIds) ? input.conversationIds : []).filter(isSafeConversationId)
    )
    if (input.pageId !== pageId || !isSafeConversationId(input.activeConversationId) || ids.length === 0) return null
    if (!ids.includes(input.activeConversationId)) ids.unshift(input.activeConversationId)
    return { version: 1, pageId, activeConversationId: input.activeConversationId, conversationIds: ids }
  }

  private writeIndex(pageId: string, index: ConversationIndex): void {
    ensureDir(this.pageChatDir(pageId))
    atomicWriteJsonSync(this.indexPath(pageId), index)
  }

  private discoverConversationIds(pageId: string): string[] {
    const dir = this.pageChatDir(pageId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .map((name) => name.match(/^(cht_[0-9A-HJKMNP-TV-Z]{26})\.chat\.json$/)?.[1])
      .filter((id): id is string => Boolean(id) && isSafeConversationId(id))
      .map((id) => this.readConversation(pageId, id))
      .filter((conversation): conversation is Conversation => Boolean(conversation))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((conversation) => conversation.id)
  }

  private projectId(pageId: string): string {
    const projectId = this.workspace.projectIdForPage(pageId)
    if (!projectId) throw new Error('Page not found')
    return projectId
  }

  private pageChatDir(pageId: string): string {
    return join(projectDir(this.projectId(pageId)), 'chats', pageId)
  }

  private indexPath(pageId: string): string {
    return join(this.pageChatDir(pageId), 'index.json')
  }

  private conversationPath(pageId: string, conversationId: string): string {
    this.assertConversationId(conversationId)
    return join(this.pageChatDir(pageId), `${conversationId}.chat.json`)
  }

  private legacyPath(pageId: string): string {
    return join(projectDir(this.projectId(pageId)), 'chats', `${pageId}.chat.json`)
  }

  private assertPageId(pageId: string): void {
    if (!/^pg_[0-9A-HJKMNP-TV-Z]{26}$/.test(pageId)) throw new Error('Invalid page id')
  }

  private assertConversationId(conversationId: string): void {
    if (!isSafeConversationId(conversationId)) throw new Error('Invalid conversation id')
  }
}

function normalizeConversation(input: Conversation, pageId: string): Conversation {
  const now = nowIso()
  const messages = Array.isArray(input.messages) ? input.messages : []
  const createdAt = input.createdAt || messages[0]?.createdAt || input.updatedAt || now
  const conversation: Conversation = {
    id: input.id,
    pageId,
    messages,
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined
  }
  conversation.title = deriveTitle(conversation)
  return conversation
}

function deriveTitle(conversation: Conversation): string {
  if (conversation.title && conversation.title !== 'New chat') return conversation.title
  const firstPrompt = conversation.messages.find((message) => message.role === 'user' && message.text.trim())
  if (!firstPrompt) return 'New chat'
  const singleLine = firstPrompt.text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 56 ? `${singleLine.slice(0, 55)}…` : singleLine
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    pageId: conversation.pageId,
    title: deriveTitle(conversation),
    createdAt: conversation.createdAt || conversation.updatedAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

function isSafeConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^cht_[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
}
