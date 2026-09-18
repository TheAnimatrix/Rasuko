<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from '$lib/components/Icon.svelte'
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  import { ICONS } from '$lib/icon-names'

  interface Props {
    sidebarCollapsed: boolean
    assistantCollapsed: boolean
    onToggleSidebar: () => void
    onToggleAssistant: () => void
  }

  let { sidebarCollapsed, assistantCollapsed, onToggleSidebar, onToggleAssistant }: Props = $props()

  let maximized = $state(false)
  const isMac = window.rasuko.platform === 'darwin'

  onMount(() => {
    void window.rasuko.window.isMaximized().then((value) => (maximized = value))
    return window.rasuko.window.onMaximizedChange((value) => (maximized = value))
  })
</script>

<header
  class="drag-region flex h-11 shrink-0 items-center justify-between bg-chrome"
  style={isMac ? 'padding-left: 82px' : undefined}
>
  <div class="flex min-w-0 items-center gap-0.5 pl-2">
    <Tooltip content={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} side="bottom">
      <button
        type="button"
        class="no-drag inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        onclick={onToggleSidebar}
      >
        <Icon name={ICONS.sidebarToggle} size={16} />
      </button>
    </Tooltip>
    <span class="wordmark select-none px-1.5 text-[17px] leading-none text-foreground">Rasuko</span>
  </div>

  <div class="no-drag flex items-center gap-0.5 pr-1.5">
    <Tooltip content={assistantCollapsed ? 'Show assistant' : 'Hide assistant'} side="bottom">
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
        class:text-accent-foreground={!assistantCollapsed}
        class:bg-accent={!assistantCollapsed}
        class:text-muted-foreground={assistantCollapsed}
        aria-label={assistantCollapsed ? 'Show assistant' : 'Hide assistant'}
        onclick={onToggleAssistant}
      >
        <Icon name={ICONS.assistant} size={16} />
      </button>
    </Tooltip>

    {#if !isMac}
      <span class="mx-1 h-4 w-px bg-border"></span>
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="Minimize"
        onclick={() => window.rasuko.window.minimize()}
      >
        <Icon name={ICONS.minimize} size={14} />
      </button>
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onclick={async () => {
          maximized = await window.rasuko.window.maximize()
        }}
      >
        <Icon name={maximized ? ICONS.restore : ICONS.maximize} size={13} />
      </button>
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Close"
        onclick={() => window.rasuko.window.close()}
      >
        <Icon name={ICONS.close} size={14} />
      </button>
    {/if}
  </div>
</header>
