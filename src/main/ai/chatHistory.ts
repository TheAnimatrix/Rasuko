import type { AssistantMessage, Message, Model, ToolCall, Usage } from '@earendil-works/pi-ai'
import type { ChatMessage } from '@shared/types'

export const MAX_MODEL_TOOL_OUTPUT_CHARS = 6_000
export const MAX_MODEL_TOOL_ARGUMENT_CHARS = 3_000
export const MAX_MODEL_MESSAGE_TEXT_CHARS = 24_000
export const MAX_MODEL_HISTORY_CHARS = 160_000
const MAX_TOOL_CALLS_PER_TURN = 12

function emptyUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

/** Restore complete tool/result pairs, including old turns with no prose. */
export function buildModelHistory(
  history: ChatMessage[],
  model: Model<import('@earendil-works/pi-ai').Api>
): Message[] {
  const groups: Array<{ messages: Message[]; chars: number }> = []
  for (const message of history) {
    const messages: Message[] = []
    const timestamp = Date.parse(message.createdAt) || Date.now()
    if (message.role === 'system') continue
    if (message.role === 'user') {
      if (message.text) messages.push({ role: 'user', content: boundText(message.text, MAX_MODEL_MESSAGE_TEXT_CHARS, 'message'), timestamp })
      if (messages.length) groups.push({ messages, chars: estimateChars(messages) })
      continue
    }
    const base = {
      role: 'assistant' as const, api: model.api, provider: model.provider,
      model: model.id, usage: emptyUsage(), timestamp
    }
    const allCalls = message.toolCalls ?? []
    const calls = allCalls.slice(-MAX_TOOL_CALLS_PER_TURN)
    if (calls.length) {
      // Mint provider-safe, unique call IDs. The persistent UI ID stays intact.
      const toolCalls: ToolCall[] = calls.map((call, index) => ({
        type: 'toolCall', id: `call_${message.id.replace(/[^a-zA-Z0-9]/g, '')}_${index}`,
        name: call.name, arguments: boundToolArguments(call.input)
      }))
      messages.push({ ...base, content: toolCalls, stopReason: 'toolUse' })
      calls.forEach((call, index) => {
        const output = boundModelToolOutput(
          call.output ?? 'This tool did not complete; inspect the current files before retrying.'
        )
        messages.push({
          role: 'toolResult', toolCallId: toolCalls[index].id, toolName: call.name,
          content: [{ type: 'text', text: output }],
          isError: Boolean(call.isError || call.output === undefined),
          timestamp: Date.parse(call.finishedAt ?? '') || timestamp
        })
      })
    }
    const omitted = allCalls.length - calls.length
    const text = [
      message.text,
      omitted > 0 ? `[${omitted} earlier tool receipts omitted from model context; inspect current files if needed.]` : '',
      message.error ? `Turn status: ${message.error}` : ''
    ].filter(Boolean).join('\n\n')
    if (text) messages.push({ ...base, content: [{ type: 'text', text: boundText(text, MAX_MODEL_MESSAGE_TEXT_CHARS, 'message') }], stopReason: 'stop' } as AssistantMessage)
    if (messages.length) groups.push({ messages, chars: estimateChars(messages) })
  }

  // Keep the newest complete ChatMessage groups. This never splits a historical
  // assistant toolCall/toolResult pair, which OpenAI-compatible APIs reject.
  const selected: typeof groups = []
  let used = 0
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (selected.length > 0 && used + group.chars > MAX_MODEL_HISTORY_CHARS) break
    selected.unshift(group)
    used += group.chars
    if (used >= MAX_MODEL_HISTORY_CHARS) break
  }
  return selected.flatMap((group) => group.messages)
}

/** Bound a tool receipt before it is sent back to a model; persisted audit data stays full. */
export function boundModelToolOutput(content: string, maxChars = MAX_MODEL_TOOL_OUTPUT_CHARS): string {
  return boundText(content, maxChars, 'tool output')
}

function boundToolArguments(input: Record<string, unknown>): Record<string, unknown> {
  let serialized = ''
  try {
    serialized = JSON.stringify(input)
  } catch {
    return { _rasukoHistoryNote: 'Tool arguments could not be serialized; inspect current files.' }
  }
  if (serialized.length <= MAX_MODEL_TOOL_ARGUMENT_CHARS) return input
  return {
    _rasukoHistoryNote: `Tool arguments omitted from model history (${serialized.length} characters); inspect current files for current state.`,
    keys: Object.keys(input).slice(0, 24)
  }
}

function boundText(content: string, maxChars: number, label: string): string {
  if (content.length <= maxChars) return content
  const marker = `\n\n[${label} truncated: ${content.length} characters total. Use read with offset/limit or grep to request a narrower slice.]\n\n`
  const remaining = Math.max(0, maxChars - marker.length)
  const head = Math.ceil(remaining * 0.75)
  const tail = remaining - head
  return `${content.slice(0, head)}${marker}${tail > 0 ? content.slice(-tail) : ''}`
}

function estimateChars(messages: Message[]): number {
  try {
    return JSON.stringify(messages).length
  } catch {
    return MAX_MODEL_HISTORY_CHARS
  }
}
