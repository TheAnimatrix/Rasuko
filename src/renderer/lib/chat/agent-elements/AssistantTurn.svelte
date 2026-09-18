<script lang="ts">
  /**
   * AssistantTurn — one assistant reply: reasoning, tool activity, prose, and
   * the hover toolbar. Turn-level grouping means a reply that used a tool loop
   * still reads as a single answer.
   */

  import type { ChatToolCall } from '@shared/types'
  import { ICONS } from '$lib/icon-names'
  import { relativeTime } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import AssistantMarkdown from './AssistantMarkdown.svelte'
  import ThinkingRow from './ThinkingRow.svelte'
  import ToolRow from './ToolRow.svelte'
  import ToolCallsGroup from './ToolCallsGroup.svelte'
  import CopyButton from './CopyButton.svelte'

  interface Props {
    text: string
    thinking?: string
    toolCalls?: ChatToolCall[]
    error?: string
    createdAt?: string
    streaming?: boolean
    showThinking?: boolean
    showToolbar?: boolean
  }

  let {
    text,
    thinking,
    toolCalls,
    error,
    createdAt,
    streaming = false,
    showThinking = true,
    showToolbar = true
  }: Props = $props()

  const calls = $derived(toolCalls ?? [])
  const hasText = $derived(text.trim().length > 0)
</script>

<div class="group/assistant-turn min-w-0">
  {#if showThinking && thinking && thinking.trim()}
    <div class="mb-2.5">
      <ThinkingRow text={thinking} pending={streaming && !hasText && calls.length === 0} />
    </div>
  {/if}

  {#if calls.length > 0}
    <div class="mb-2.5">
      {#if calls.length === 1}
        <ToolRow call={calls[0]} />
      {:else}
        <ToolCallsGroup count={calls.length} autoOpen={streaming}>
          {#each calls as call (call.id)}
            <ToolRow {call} />
          {/each}
        </ToolCallsGroup>
      {/if}
    </div>
  {/if}

  {#if hasText}
    <AssistantMarkdown content={text} />
  {/if}

  {#if error}
    <div
      class="mt-2 flex items-start gap-1.5 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-foreground"
    >
      <Icon name={ICONS.alert} size={13} class="mt-px shrink-0 text-destructive" />
      <span class="min-w-0 flex-1 break-words text-pretty">{error}</span>
    </div>
  {/if}

  {#if showToolbar && (hasText || createdAt)}
    <div
      class="mt-1 flex h-6 items-center gap-1 text-[11px] text-muted-foreground/70 opacity-0 transition-opacity duration-100 group-hover/assistant-turn:opacity-100"
    >
      {#if createdAt}
        <span>{relativeTime(createdAt)}</span>
      {/if}
      {#if hasText}
        <CopyButton text={text} />
      {/if}
    </div>
  {/if}
</div>
