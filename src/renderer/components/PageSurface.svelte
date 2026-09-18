<script lang="ts">
  /**
   * PageSurface — the page's center pane.
   *
   * A page renders a View (presentation) bound to records (content). This
   * component adds the small amount of page chrome the View itself should not
   * own: the editable title, the View actions menu, unplaced content, and a
   * quiet status strip for custom Views.
   */

  import { workspace } from '$lib/stores/workspace.svelte'
  import { chat } from '$lib/stores/chat.svelte'
  import ViewNode from '$lib/view/ViewNode.svelte'
  import UnplacedContent from '$lib/view/UnplacedContent.svelte'
  import Spinner from '$lib/components/ui/Spinner.svelte'
  import Badge from '$lib/components/ui/Badge.svelte'
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Textarea from '$lib/components/ui/Textarea.svelte'
  import Icon from '$lib/components/Icon.svelte'
  import { downloadText } from '$lib/utils'
  import { walk } from '@shared/viewOps'
  import { ICONS } from '$lib/icon-names'
  import { cn } from '$lib/utils'
  import ViewSettings from './ViewSettings.svelte'
  import { flushEditors } from '$lib/flushEditors'
  import { trackUiWrite } from '$lib/pendingUiWrites'
  import { onDestroy } from 'svelte'

  interface Props {
    pageId: string
  }

  let { pageId }: Props = $props()

  // One payload owns the tree and the editable records. Workspace broadcasts
  // and assistant receipts refresh this store with request-order protection.
  const payload = $derived(workspace.payload?.page.id === pageId ? workspace.payload : null)

  const ready = $derived(payload !== null && payload.page.id === pageId)

  let title = $state('')
  let editingTitle = $state(false)
  let redesignOpen = $state(false)
  let redesignPrompt = $state('')
  let settingsOpen = $state(false)
  let titleTimer: ReturnType<typeof setTimeout> | undefined
  let titlePending: Promise<void> | undefined
  let titleDirty = false, titleVersion = 0, titlePageId = ''

  // Keep the title field in sync with the page unless the user is editing it.
  $effect(() => {
    const current = workspace.payload
    if (!current || current.page.id !== pageId) return
    if (!editingTitle && !titleDirty) title = current.page.title
  })

  const showTitle = $derived.by(() => {
    const current = payload
    if (!current) return false
    // A View that renders its own heading owns the title. Showing the chrome
    // input as well would print the title on the page twice — which is exactly
    // what a stray heading node on a barebones page used to do.
    const children = current.view.root.children ?? []
    return !children.some((child: { type: string }) => child.type === 'heading')
  })

  const nodeCount = $derived.by(() => {
    const current = payload
    if (!current) return 0
    let count = 0
    walk(current.view.root, () => {
      count += 1
    })
    return count
  })

  function saveTitle(): Promise<void> | undefined {
    clearTimeout(titleTimer)
    if (!titleDirty) return titlePending
    const target = titlePageId, value = title, version = titleVersion
    titleDirty = false
    const operation = trackUiWrite((titlePending ?? Promise.resolve()).catch(() => undefined).then(() => workspace.renamePage(target, value)).catch((error) => {
      if (version === titleVersion) titleDirty = true
      window.dispatchEvent(new CustomEvent('rasuko:save-error', { detail: error instanceof Error ? error.message : 'Could not save the page title' }))
      throw error
    }))
    titlePending = operation
    void operation.then(() => { if (titlePending === operation) titlePending = undefined }, () => { if (titlePending === operation) titlePending = undefined })
    return operation
  }
  const saveTitleQuietly = () => { void saveTitle()?.catch(() => undefined) }
  $effect(() => {
    const handler = (event: Event) => {
      const saving = saveTitle()
      if (saving) (event as CustomEvent<{ waitUntil?: (promise: Promise<unknown>) => void }>).detail?.waitUntil?.(saving)
    }
    window.addEventListener('rasuko:flush-editors', handler)
    return () => window.removeEventListener('rasuko:flush-editors', handler)
  })
  onDestroy(saveTitleQuietly)

  function onTitleInput(event: Event): void {
    title = (event.currentTarget as HTMLInputElement).value
    titleDirty = true; titleVersion += 1; titlePageId = pageId
    clearTimeout(titleTimer)
    titleTimer = setTimeout(saveTitleQuietly, 300)
  }

  const menuItems = [
    { id: 'settings', label: 'View settings…', icon: ICONS.settings },
    { id: 'ask', label: 'Ask assistant to redesign…', icon: ICONS.sparkles },
    { id: 'edit-view', label: 'Convert to a custom View', icon: ICONS.layout },
    { id: 'revert', label: 'Revert to the minimal writing surface', icon: ICONS.document },
    { id: 'duplicate', label: 'Duplicate View', icon: ICONS.duplicate, separatorBefore: true },
    { id: 'export', label: 'Export View as .rasukoview', icon: ICONS.export },
    { id: 'markdown', label: 'Toggle Markdown input', icon: ICONS.text, separatorBefore: true }
  ]

  async function onMenu(id: string): Promise<void> {
    await flushEditors()
    const current = workspace.payload
    if (!current) return
    const projectId = current.page.projectId
    const viewId = current.view.id
    switch (id) {
      case 'settings':
        settingsOpen = true
        break
      case 'ask':
        redesignPrompt = ''
        redesignOpen = true
        break
      case 'edit-view':
        await workspace.applyOps([{ op: 'setKind', kind: 'custom' }], 'Converted to a custom View')
        break
      case 'revert':
        await workspace.revertToBarebones()
        break
      case 'duplicate':
        await window.rasuko.view.duplicate(projectId, viewId)
        await workspace.refreshPayload()
        break
      case 'export': {
        const json = await window.rasuko.view.exportView(projectId, viewId)
        if (json) downloadText(`${current.view.name || 'view'}.rasukoview`, json)
        break
      }
      case 'markdown':
        await workspace.setPageMarkdown(pageId, !current.page.markdown)
        break
      default:
        break
    }
  }

  function submitRedesign(): void {
    const text = redesignPrompt.trim()
    if (text) void chat.send(text, 'architect')
    redesignOpen = false
  }
</script>

<Dialog bind:open={settingsOpen} title="View settings" description="Presentation and content bindings">
  {#if payload}<ViewSettings view={payload.view} records={payload.records} />{/if}
</Dialog>

{#if !ready || !payload}
  <div class="flex min-h-0 flex-1 items-center justify-center">
    <Spinner size={18} label="Loading page" />
  </div>
{:else}
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if showTitle}
        <div class="group/page mx-auto flex w-full max-w-3xl items-start gap-2 px-8 pt-8">
          <input
            class="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Untitled"
            value={title}
            oninput={onTitleInput}
            onfocus={() => (editingTitle = true)}
            onblur={() => {
              editingTitle = false
              saveTitleQuietly()
            }}
            aria-label="Page title"
          />
          <DropdownMenu items={menuItems} onselect={(id) => void onMenu(id)}>
            {#snippet trigger()}
              <button
                type="button"
                class="mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/page:opacity-100"
                aria-label="Page actions"
              >
                <Icon name={ICONS.moreVertical} size={16} />
              </button>
            {/snippet}
          </DropdownMenu>
        </div>
      {:else}
        <div class="group/page mx-auto flex w-full max-w-3xl justify-end px-8 pt-4">
          <DropdownMenu items={menuItems} onselect={(id) => void onMenu(id)}>
            {#snippet trigger()}
              <button
                type="button"
                class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/page:opacity-100"
                aria-label="Page actions"
              >
                <Icon name={ICONS.moreVertical} size={16} />
              </button>
            {/snippet}
          </DropdownMenu>
        </div>
      {/if}

      <!-- Keep editors mounted across refreshes of the same View. Child node IDs
           determine which components survive a redesign. -->
      {#key `${payload.page.id}:${payload.view.id}`}
        <div class="font-sans text-[14px] leading-relaxed text-foreground">
          <div
            class={cn(
              'flex w-full flex-col',
              workspace.payload?.view.root.props?.width === 'narrow'
                ? 'max-w-2xl'
                : workspace.payload?.view.root.props?.width === 'wide'
                  ? 'max-w-5xl'
                  : workspace.payload?.view.root.props?.width === 'full'
                    ? 'max-w-none'
                    : 'max-w-3xl',
              String(workspace.payload?.view.root.props?.align ?? 'center') === 'start'
                ? 'mr-auto ml-0'
                : 'mx-auto'
            )}
            style="gap:{Math.max(0, Number(workspace.payload?.view.root.props?.gap ?? 16) || 0)}px; padding:{Math.max(
              0,
              Number(workspace.payload?.view.root.props?.padding ?? 40) || 0
            )}px;"
          >
            {#each workspace.payload?.view.root.children ?? [] as child (child.id)}
              <ViewNode
                node={child}
                records={workspace.payload?.records ?? {}}
                editable
                onrequestRedesign={(nodeId) =>
                  chat.send(
                    `Redesign the section with node id ${nodeId} in this page's View. Keep all existing content bound.`,
                    'architect'
                  )}
              />
            {/each}
          </div>
        </div>
      {/key}

      {#if payload.orphaned.length > 0}
        <div class="mx-auto w-full max-w-3xl px-8 pb-8">
          <UnplacedContent orphaned={payload.orphaned} />
        </div>
      {/if}
    </div>

    {#if payload.view.kind === 'custom'}
      <div
        class="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground"
      >
        <Icon name={ICONS.layout} size={12} />
        <span class="min-w-0 truncate">{payload.view.name}</span>
        <button class="ml-auto rounded px-2 py-1 hover:bg-accent" onclick={async () => { await flushEditors(); settingsOpen = true }}>View settings</button>
      </div>
    {/if}
  </div>
{/if}

<Dialog
  bind:open={redesignOpen}
  title="Ask assistant to redesign"
  description="Describe the structure you want. Existing content stays bound."
>
  <Textarea
    bind:value={redesignPrompt}
    rows={4}
    placeholder="e.g. Turn this into a project tracker with a status board"
  />
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (redesignOpen = false)}>Cancel</Button>
    <Button onclick={submitRedesign}>Send to assistant</Button>
  {/snippet}
</Dialog>
