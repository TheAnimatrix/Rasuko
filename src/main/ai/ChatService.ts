import { createHash } from 'node:crypto'
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context as PiContext,
  Message as PiMessage,
  Model,
  ThinkingLevel,
  Tool as PiTool,
  ToolCall
} from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'
import type { ChatMessage, ChatToolCall, Conversation, ConversationSummary } from '@shared/types'
import type { ChatStreamEvent } from '@shared/ipc'
import { newId, nowIso } from '@shared/ids'
import { parseThinkingSuffixFromModelId } from '@shared/modelVariants'
import type { WorkspaceStore } from '../workspace/WorkspaceStore'
import type { ProviderService } from '../providers/ProviderService'
import type { SettingsStore } from '../settings/SettingsStore'
import { allTools, buildToolContext } from './tools'
import { ConversationStore } from './ConversationStore'
import { boundModelToolOutput, buildModelHistory } from './chatHistory'
import {
  CHAT_SYSTEM,
  VIEW_ARCHITECT_SYSTEM,
  describePageContext,
  localPlan,
  type ArchitectContext
} from './ViewArchitect'

export interface ChatServiceEvents {
  onEvent: (event: ChatStreamEvent) => void
}

export interface SendInput {
  pageId: string
  text: string
  /** Ask the architect to restructure the View rather than chat. */
  mode?: 'chat' | 'architect'
}

const MAX_TOOL_ROUNDS = 8
const MAX_HISTORY_MESSAGES = 40

type TurnEvent = {
  [K in ChatStreamEvent['type']]: Omit<Extract<ChatStreamEvent, { type: K }>, 'pageId' | 'conversationId'>
}[ChatStreamEvent['type']]

/** A resolved model plus the thinking level encoded in its `model:effort` id. */
interface ModelSelection {
  model: Model<import('@earendil-works/pi-ai').Api>
  reasoning: ThinkingLevel | 'off'
}

/**
 * Owns conversations and the streaming tool loop.
 * All model traffic lives here in the main process; the renderer only sees events.
 */
export class ChatService {
  private readonly conversations: ConversationStore
  private active = new Map<string, AbortController>()
  private turns = new Map<string, { pageId: string; conversationId: string }>()
  private drafts = new Map<string, ChatMessage>()

  /** Assigned by the IPC layer so streaming events reach the renderer. */
  onEvent: (event: ChatStreamEvent) => void = () => undefined

  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly providers: ProviderService,
    private readonly settings: SettingsStore
  ) {
    this.conversations = new ConversationStore(workspace)
  }

  private emit(event: TurnEvent): void {
    const scope = this.turns.get(event.turnId)
    if (scope) this.onEvent({ ...event, ...scope } as ChatStreamEvent)
  }

  /* ------------------------------ conversations ----------------------------- */

  history(pageId: string): ChatMessage[] {
    return this.conversation(pageId).messages
  }

  private conversation(pageId: string): Conversation {
    return this.conversations.getActive(pageId)
  }

  current(pageId: string): Conversation {
    return this.conversation(pageId)
  }

  list(pageId: string): ConversationSummary[] {
    return this.conversations.list(pageId)
  }

  create(pageId: string): Conversation {
    this.requireIdle(pageId)
    return this.conversations.create(pageId)
  }

  select(pageId: string, conversationId: string): Conversation {
    this.requireIdle(pageId)
    return this.conversations.select(pageId, conversationId)
  }

  private requireIdle(pageId: string): void {
    if (this.active.has(pageId)) throw new Error('Wait for the current reply to finish, or stop it first.')
  }

  private persist(conversation: Conversation): void {
    this.conversations.persist(conversation)
  }

  clear(pageId: string): void {
    // Older clients can still start fresh without destroying their previous chat.
    this.create(pageId)
  }

  abort(pageId: string): boolean {
    const controller = this.active.get(pageId)
    if (!controller) return false
    controller.abort()
    return true
  }

  isActive(pageId: string): boolean {
    return this.active.has(pageId)
  }

  /* ---------------------------------- send --------------------------------- */

  async send(input: SendInput): Promise<ChatMessage> {
    this.requireIdle(input.pageId)
    const conversation = this.conversation(input.pageId)
    const text = input.text.trim()
    if (!text) throw new Error('Message is empty')

    const userMessage: ChatMessage = { id: newId('message'), role: 'user', text, createdAt: nowIso() }
    conversation.messages.push(userMessage)
    this.persist(conversation)

    const turnId = newId('turn')
    const controller = new AbortController()
    this.active.set(input.pageId, controller)
    this.turns.set(turnId, { pageId: input.pageId, conversationId: conversation.id })
    this.emit({ type: 'turn_start', turnId })

    try {
      const architect = input.mode === 'architect' || looksLikeRedesign(text)
      const resolved = this.resolveModel()
      const assistant = resolved
        ? await this.runModelTurn(input.pageId, conversation, architect, resolved, controller.signal, turnId)
        : await this.runOfflineTurn(input.pageId, text, architect, turnId)

      conversation.messages.push(assistant)
      this.persist(conversation)
      this.emit({ type: 'turn_end', turnId, message: assistant })
      return assistant
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The assistant failed.'
      const assistant: ChatMessage = this.drafts.get(turnId) ?? {
        id: newId('message'),
        role: 'assistant',
        text: '',
        error: message,
        createdAt: nowIso()
      }
      assistant.streaming = false
      assistant.error = message
      conversation.messages.push(assistant)
      this.persist(conversation)
      this.emit({ type: 'error', turnId, message })
      this.emit({ type: 'turn_end', turnId, message: assistant })
      return assistant
    } finally {
      this.active.delete(input.pageId)
      this.turns.delete(turnId)
      this.drafts.delete(turnId)
    }
  }

  private resolveModel(): ModelSelection | undefined {
    const settings = this.settings.get()
    const { providerId, model } = settings.assistant.model
    if (!providerId || !model) return undefined

    // The renderer encodes the thinking level as `model:effort`; the catalog
    // only knows the base id.
    const { baseId, effort } = parseThinkingSuffixFromModelId(model)
    const resolved = this.providers.resolveModel(providerId, baseId) ?? this.providers.resolveModel(providerId, model)
    if (!resolved) return undefined

    return { model: resolved, reasoning: (effort ?? 'off') as ThinkingLevel | 'off' }
  }

  private architectContext(pageId: string): ArchitectContext | null {
    const payload = this.workspace.pagePayload(pageId)
    if (!payload) return null
    return {
      page: payload.page,
      view: payload.view,
      records: payload.records,
      orphaned: payload.orphaned
    }
  }

  /* ------------------------------- offline turn ----------------------------- */

  private async runOfflineTurn(
    pageId: string,
    text: string,
    architect: boolean,
    turnId: string
  ): Promise<ChatMessage> {
    const ctx = this.architectContext(pageId)
    if (!ctx) throw new Error('Page not found')
    const projectId = ctx.page.projectId

    if (!architect) {
      const assistant: ChatMessage = {
        id: newId('message'),
        role: 'assistant',
        text: `No model is configured yet, so I am running in offline mode.\n\nI can still restructure this page deterministically. Try: "make this a project tracker", "turn this into a dashboard", "add a checklist", "make it a form", or "back to notes".\n\nTo connect a model, open Settings → Providers and add an API key.`,
        createdAt: nowIso()
      }
      this.streamText(assistant, turnId)
      return assistant
    }

    const plan = localPlan(text, ctx)
    const assistant: ChatMessage = {
      id: newId('message'),
      role: 'assistant',
      text: '',
      toolCalls: [],
      createdAt: nowIso()
    }

    // Validate and commit the complete deterministic plan as one recoverable
    // transaction. No record is visible unless every record and final binding
    // is valid and every View op applies.
    const result = this.workspace.applyViewPlan(
      projectId,
      ctx.view.id,
      plan.records,
      plan.ops,
      plan.summary,
      ctx.view.revision ?? 0
    )
    if (!result) throw new Error('View not found')

    for (const record of plan.records) {
      const id = newId('message')
      const input = { kind: record.kind, recordId: record.id, label: record.label }
      this.emit({ type: 'tool_start', turnId, id, name: 'record_create', input })
      assistant.toolCalls!.push({
        id,
        name: 'record_create',
        input,
        output: `Created ${record.kind} record ${record.id}`,
        startedAt: nowIso(),
        finishedAt: nowIso()
      })
      this.emit({
        type: 'tool_end',
        turnId,
        id: assistant.toolCalls!.at(-1)!.id,
        output: `Created ${record.kind} record ${record.id}`,
        isError: false
      })
    }

    const opCallId = newId('message')
    this.emit({
      type: 'tool_start',
      turnId,
      id: opCallId,
      name: 'view_applyOps',
      input: { ops: plan.ops, summary: plan.summary }
    })

    this.emit({ type: 'view_ops', turnId, receipt: result.receipt })
    const output = JSON.stringify(result.receipt)
    assistant.toolCalls!.push({
      id: opCallId,
      name: 'view_applyOps',
      input: { ops: plan.ops, summary: plan.summary },
      output,
      startedAt: nowIso(),
      finishedAt: nowIso()
    })
    this.emit({ type: 'tool_end', turnId, id: opCallId, output, isError: false })

    assistant.text = plan.reply
    this.streamText(assistant, turnId)
    return assistant
  }

  private streamText(assistant: ChatMessage, turnId: string): void {
    const chunks = assistant.text.match(/[\s\S]{1,24}/g) ?? []
    for (const chunk of chunks) {
      this.emit({ type: 'text_delta', turnId, delta: chunk })
    }
  }

  /* -------------------------------- model turn ------------------------------ */

  private async runModelTurn(
    pageId: string,
    conversation: Conversation,
    architect: boolean,
    selection: ModelSelection,
    signal: AbortSignal,
    turnId: string
  ): Promise<ChatMessage> {
    const { model, reasoning } = selection
    const ctx = this.architectContext(pageId)
    if (!ctx) throw new Error('Page not found')

    // Ordinary follow-ups such as "change that title" need the same workspace
    // tools as a redesign. Mode controls guidance, not whether the model can edit.
    const toolDefs = allTools()
    const piTools: PiTool[] = toolDefs.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }))

    // The current user message is already persisted. Reconstruct tool calls and
    // their receipts as well as prose, so later turns remember the actual edits.
    const messages = buildModelHistory(conversation.messages.slice(-MAX_HISTORY_MESSAGES), model)

    const assistant: ChatMessage = {
      id: newId('message'),
      role: 'assistant',
      text: '',
      thinking: '',
      toolCalls: [],
      streaming: true,
      createdAt: nowIso()
    }
    this.drafts.set(turnId, assistant)

    const settings = this.settings.get()
    const models = this.providers.getModelsApi()
    const sessionId = conversationSessionId(conversation.id)
    const sessionHeaders = providerSessionHeaders(model, sessionId)
    const toolContext = buildToolContext(this.workspace, pageId, (receipt) => {
      this.emit({ type: 'view_ops', turnId, receipt })
    })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (signal.aborted) throw new Error('Turn cancelled')

      // A prior tool call may have replaced the entire View or edited its files.
      // Never send the pre-edit tree back as CURRENT PAGE on the next round.
      const latest = this.architectContext(pageId)
      if (!latest) throw new Error('Page is no longer available')
      const system = `${architect ? VIEW_ARCHITECT_SYSTEM : CHAT_SYSTEM}\n\n${describePageContext(latest)}`

      const stream = models.streamSimple(
        model,
        { systemPrompt: system, messages, tools: piTools.length > 0 ? piTools : undefined } as PiContext,
        {
          signal,
          temperature: settings.assistant.temperature,
          sessionId,
          ...(sessionHeaders ? { headers: sessionHeaders } : {}),
          ...(reasoning !== 'off' ? { reasoning } : {})
        }
      )

      let final: AssistantMessage | null = null
      for await (const event of stream as AsyncIterable<AssistantMessageEvent>) {
        if (signal.aborted) break
        switch (event.type) {
          case 'text_delta':
            assistant.text += event.delta
            this.emit({ type: 'text_delta', turnId, delta: event.delta })
            break
          case 'thinking_delta':
            assistant.thinking = (assistant.thinking ?? '') + event.delta
            if (settings.assistant.showThinking) {
              this.emit({ type: 'thinking_delta', turnId, delta: event.delta })
            }
            break
          case 'done':
            final = event.message
            break
          case 'error':
            final = event.error
            break
          default:
            break
        }
      }

      if (!final) {
        try {
          final = await stream.result()
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'The model returned no response.')
        }
      }
      if (!final) throw new Error('The model returned no response.')
      if (signal.aborted) throw new Error('Turn cancelled')
      if (final.errorMessage) throw new Error(final.errorMessage)

      messages.push(final)

      const calls: ToolCall[] = final.content.filter(
        (block): block is ToolCall => block.type === 'toolCall'
      )
      if (final.stopReason !== 'toolUse' || calls.length === 0) break

      for (const call of calls) {
        if (signal.aborted) throw new Error('Turn cancelled')
        const tool = toolDefs.find((t) => t.name === call.name)
        const canonicalName = tool?.name ?? call.name
        const startedAt = nowIso()
        const record = (output: string, isError: boolean) => {
          const toolCall: ChatToolCall = {
            id: call.id,
            name: canonicalName,
            input: call.arguments ?? {},
            output,
            isError,
            startedAt,
            finishedAt: nowIso()
          }
          assistant.toolCalls!.push(toolCall)
          this.emit({ type: 'tool_end', turnId, id: call.id, output, isError })
        }

        this.emit({
          type: 'tool_start',
          turnId,
          id: call.id,
          name: canonicalName,
          input: (call.arguments ?? {}) as Record<string, unknown>
        })

        if (signal.aborted) throw new Error('Turn cancelled')

        if (!tool) {
          const output = `Unknown tool: ${call.name}`
          record(output, true)
          messages.push(toolResult(call, boundModelToolOutput(output), true))
          continue
        }

        try {
          const result = await tool.execute(call.arguments ?? {}, toolContext)
          record(result.content, Boolean(result.isError))
          messages.push(toolResult(call, boundModelToolOutput(result.content), Boolean(result.isError)))
        } catch (error) {
          const output = error instanceof Error ? error.message : 'Tool failed'
          record(output, true)
          messages.push(toolResult(call, boundModelToolOutput(output), true))
        }
      }
    }

    assistant.streaming = false
    if (!assistant.text.trim()) {
      assistant.text = 'Done.'
    }
    return assistant
  }
}

/**
 * Stable per-conversation session id.
 *
 * Deterministic from the conversation id, so it survives restarts and requests in
 * one conversation shares it — which is what providers use it for (routing
 * affinity + prompt caching).
 */
function conversationSessionId(conversationId: string): string {
  return `rasuko-${createHash('sha256').update(conversationId).digest('hex').slice(0, 32)}`
}

/**
 * OpenCode (Zen / Go) rejects requests without a stable `x-opencode-session`
 * header (400 MissingSessionID). pi-ai does not emit it, so it is supplied
 * here. The docs also ask clients to identify themselves with their own user
 * agent instead of the generic SDK one.
 */
function providerSessionHeaders(
  model: Model<import('@earendil-works/pi-ai').Api>,
  sessionId: string
): Record<string, string> | undefined {
  const isOpenCode =
    model.provider === 'opencode' ||
    model.provider === 'opencode-go' ||
    (model.baseUrl ?? '').includes('opencode.ai')
  if (!isOpenCode) return undefined
  return { 'x-opencode-session': sessionId, 'User-Agent': 'Rasuko/0.1.0' }
}

function toolResult(call: ToolCall, content: string, isError: boolean): PiMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: content }],
    isError,
    timestamp: Date.now()
  } as PiMessage
}

/** Heuristic: does this message ask for a View restructure? */
export function looksLikeRedesign(text: string): boolean {
  const t = text.toLowerCase()
  const verbs = [
    'redesign',
    'restructure',
    'turn this',
    'turn it',
    'make this',
    'make it',
    'convert',
    'rebuild',
    'reorganize',
    'reorganise',
    'layout',
    'dashboard',
    'tracker',
    'kanban',
    'board',
    'checklist',
    'form',
    'table for',
    'add a chart',
    'add metrics',
    'back to notes'
  ]
  return verbs.some((v) => t.includes(v))
}

export { Type }
