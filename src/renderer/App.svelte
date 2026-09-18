<script lang="ts">
  import { Router } from 'sv-router'
  import './router'
  import TitleBar from './components/TitleBar.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Assistant from './components/Assistant.svelte'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { chat } from '$lib/stores/chat.svelte'
  import { providers } from '$lib/stores/providers.svelte'
  import { attachResize, type ResizeHandle } from '$lib/resizable'
  import { onMount } from 'svelte'
  import { flushEditors } from '$lib/flushEditors'

  let sidebarCollapsed = $state(false)
  let assistantCollapsed = $state(true)
  let sidebarWidth = $state(248)
  let assistantWidth = $state(368)
  let sidebarResizer = $state<HTMLDivElement | null>(null)
  let assistantResizer = $state<HTMLDivElement | null>(null)
  let viewportWidth = $state(typeof window === 'undefined' ? 1280 : window.innerWidth)

  /**
   * Panels are collapsed rather than squeezed when the window gets narrow. A
   * fixed-width sidebar plus assistant would otherwise eat the whole width and
   * leave the page with nothing to render into — which reads as the app
   * breaking on resize.
   */
  const SIDEBAR_MIN_VIEWPORT = 620
  const ASSISTANT_MIN_VIEWPORT = 860
  const CONTENT_MIN_WIDTH = 320

  const sidebarVisible = $derived(!sidebarCollapsed && viewportWidth >= SIDEBAR_MIN_VIEWPORT)
  const assistantVisible = $derived(!assistantCollapsed && viewportWidth >= ASSISTANT_MIN_VIEWPORT)

  const effectiveSidebarWidth = $derived(
    Math.max(
      180,
      Math.min(
        sidebarWidth,
        Math.max(180, viewportWidth - CONTENT_MIN_WIDTH - (assistantVisible ? assistantWidth : 0))
      )
    )
  )

  const effectiveAssistantWidth = $derived(
    Math.max(
      260,
      Math.min(
        assistantWidth,
        Math.max(260, viewportWidth - CONTENT_MIN_WIDTH - (sidebarVisible ? effectiveSidebarWidth : 0))
      )
    )
  )

  function readLayout() {
    sidebarCollapsed = localStorage.getItem('rasuko:sidebar-collapsed') === '1'
    assistantCollapsed = localStorage.getItem('rasuko:assistant-collapsed') !== '0'
    const storedSidebar = Number(localStorage.getItem('rasuko:sidebar-width'))
    const storedAssistant = Number(localStorage.getItem('rasuko:assistant-width'))
    if (Number.isFinite(storedSidebar) && storedSidebar > 0) sidebarWidth = storedSidebar
    if (Number.isFinite(storedAssistant) && storedAssistant > 0) assistantWidth = storedAssistant
  }

  onMount(() => {
    readLayout()
    viewportWidth = window.innerWidth
    void workspace.init()
    void providers.load()

    const onResize = () => {
      viewportWidth = window.innerWidth
    }
    const toggleAssistant = () => {
      assistantCollapsed = !assistantCollapsed
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('rasuko:toggle-assistant', toggleAssistant)
    const saveError = (event: Event) => { workspace.error = String((event as CustomEvent).detail) }
    window.addEventListener('rasuko:save-error', saveError)
    const stopClose = window.rasuko.window.onFlushRequest(async (token) => {
      try { await flushEditors(); window.rasuko.window.finishClose(token, true) }
      catch { window.rasuko.window.finishClose(token, false) }
    })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('rasuko:toggle-assistant', toggleAssistant)
      window.removeEventListener('rasuko:save-error', saveError)
      stopClose()
    }
  })

  $effect(() => {
    localStorage.setItem('rasuko:sidebar-collapsed', sidebarCollapsed ? '1' : '0')
  })
  $effect(() => {
    localStorage.setItem('rasuko:assistant-collapsed', assistantCollapsed ? '1' : '0')
  })
  $effect(() => {
    if (!sidebarVisible) return
    localStorage.setItem('rasuko:sidebar-width', String(sidebarWidth))
  })
  $effect(() => {
    if (!assistantVisible) return
    localStorage.setItem('rasuko:assistant-width', String(assistantWidth))
  })

  $effect(() => {
    const element = sidebarResizer
    if (!element) return
    const handle: ResizeHandle = attachResize({
      handle: element,
      direction: 'right',
      get: () => sidebarWidth,
      set: (value) => (sidebarWidth = value),
      min: 180,
      max: Math.max(240, Math.round(viewportWidth * 0.4))
    })
    return () => handle.destroy()
  })

  $effect(() => {
    const element = assistantResizer
    if (!element) return
    const handle: ResizeHandle = attachResize({
      handle: element,
      direction: 'left',
      get: () => assistantWidth,
      set: (value) => (assistantWidth = value),
      min: 260,
      max: Math.max(320, Math.round(viewportWidth * 0.5))
    })
    return () => handle.destroy()
  })

  // Keep the transcript pointed at the open page.
  $effect(() => {
    const pageId = workspace.activePageId
    if (pageId) void chat.attach(pageId)
  })

  // Surface content a redesign left unbound.
  $effect(() => {
    const payload = workspace.payload
    if (payload) chat.syncSuggestions(payload.view, payload.records)
  })
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden bg-chrome text-foreground">
  <TitleBar
    sidebarCollapsed={!sidebarVisible}
    assistantCollapsed={!assistantVisible}
    onToggleSidebar={() => (sidebarCollapsed = !sidebarCollapsed)}
    onToggleAssistant={() => (assistantCollapsed = !assistantCollapsed)}
  />

  {#if workspace.error}
    <div role="alert" class="mx-2 mb-2 flex items-center gap-3 rounded-md border border-destructive/30 bg-background px-3 py-2 text-[12px] text-destructive">
      <span class="flex-1">{workspace.error}</span>
      <button class="rounded px-2 py-1 font-medium hover:bg-accent" onclick={async () => { try { await flushEditors(); workspace.error = null } catch { /* The banner keeps the error visible. */ } }}>Retry saving</button>
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 gap-2 px-2 pb-2">
    {#if sidebarVisible}
      <aside
        class="min-h-0 shrink-0 overflow-hidden rounded-[var(--panel-radius)] border border-sidebar-border bg-sidebar"
        style="width: {effectiveSidebarWidth}px; box-shadow: var(--shadow-panel)"
      >
        <Sidebar />
      </aside>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={sidebarResizer}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabindex="0"
        class="group relative z-10 -mx-1.5 w-1 shrink-0 cursor-col-resize outline-none"
      >
        <span
          class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-ring/40 group-focus-visible:bg-ring/60"
        ></span>
      </div>
    {/if}

    <main
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--panel-radius)] border border-border bg-background"
      style="box-shadow: var(--shadow-panel)"
    >
      <Router />
    </main>

    {#if assistantVisible}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={assistantResizer}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        tabindex="0"
        class="group relative z-10 -mx-1.5 w-1 shrink-0 cursor-col-resize outline-none"
      >
        <span
          class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-ring/40 group-focus-visible:bg-ring/60"
        ></span>
      </div>
      <aside
        class="min-h-0 shrink-0 overflow-hidden rounded-[var(--panel-radius)] border border-border bg-card"
        style="width: {effectiveAssistantWidth}px; box-shadow: var(--shadow-panel)"
      >
        <Assistant />
      </aside>
    {/if}
  </div>
</div>
