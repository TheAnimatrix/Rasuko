<script lang="ts">
  /**
   * Sidebar — the projects → pages tree.
   *
   * Takes no props: it reads the workspace store directly so the shell can mount
   * it wherever it likes. Which projects are expanded is session UI state, kept
   * in localStorage, not part of the workspace document.
   */

  import type { PageMeta, ProjectMeta } from '@shared/types'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { providers } from '$lib/stores/providers.svelte'
  import { settingsStore, updateSettings } from '$lib/stores/settings.svelte'
  import { navigate } from '$lib/router'
  import { cn, relativeTime } from '$lib/utils'
  import Icon from '$lib/components/Icon.svelte'
  import IconButton from '$lib/components/ui/IconButton.svelte'
  import Input from '$lib/components/ui/Input.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Dialog from '$lib/components/ui/Dialog.svelte'
  import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte'
  import Popover from '$lib/components/ui/Popover.svelte'
  import EmptyState from '$lib/components/ui/EmptyState.svelte'
  import Spinner from '$lib/components/ui/Spinner.svelte'
  import { ICONS } from '$lib/icon-names'

  const EXPANDED_KEY = 'rasuko:expanded-projects'

  /** Per-project row tints so the tree reads at a glance. */
  const ROW_TINTS = [
    'text-orange-500',
    'text-emerald-500',
    'text-pink-500',
    'text-violet-500',
    'text-sky-500',
    'text-amber-500',
    'text-rose-500',
    'text-teal-500'
  ]

  /**
   * Projects are expanded by default — a sidebar that starts closed on a
   * single-project workspace reads as empty. We therefore persist the
   * *collapsed* set, and treat "never touched" as expanded.
   */
  function loadExpanded(): Set<string> {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY)
      if (!raw) return new Set()
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === 'string'))
      }
    } catch {
      // Corrupt session state is not worth surfacing.
    }
    return new Set()
  }

  let query = $state('')
  let collapsed = $state<Set<string>>(loadExpanded())

  let recentOpen = $state(false)

  let renameProjectOpen = $state(false)
  let renameProjectTarget = $state<ProjectMeta | null>(null)
  let renameProjectName = $state('')

  let renamePageOpen = $state(false)
  let renamePageTarget = $state<PageMeta | null>(null)
  let renamePageTitle = $state('')

  let deleteProjectOpen = $state(false)
  let deleteProjectTarget = $state<ProjectMeta | null>(null)

  let deletePageOpen = $state(false)
  let deletePageTarget = $state<PageMeta | null>(null)

  const q = $derived(query.trim().toLowerCase())
  const empty = $derived(workspace.projects.length === 0)

  /** The 5 most recently updated, non-trashed pages across every project. */
  const recentPages = $derived.by(() => {
    const pages = Object.values(workspace.index?.pages ?? {}).filter((page) => !page.trashed)
    return [...pages]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  })

  const rows = $derived.by(() => {
    const projects = workspace.projects
    if (!q) return projects.map((project) => ({ project, pages: workspace.pagesFor(project.id) }))
    return projects
      .map((project) => {
        const all = workspace.pagesFor(project.id)
        const projectMatches = project.name.toLowerCase().includes(q)
        const pages = projectMatches ? all : all.filter((page) => page.title.toLowerCase().includes(q))
        return { project, pages, projectMatches }
      })
      .filter((row) => row.projectMatches || row.pages.length > 0)
  })

  const addItems = [
    { id: 'project', label: 'New project', icon: ICONS.projectAdd },
    { id: 'page', label: 'New page', icon: ICONS.pageAdd }
  ]

  const projectItems = [
    { id: 'new-page', label: 'New page', icon: ICONS.pageAdd },
    { id: 'rename', label: 'Rename', icon: ICONS.edit },
    { id: 'new-project', label: 'New project', icon: ICONS.projectAdd, separatorBefore: true },
    { id: 'delete', label: 'Delete project', icon: ICONS.delete, danger: true, separatorBefore: true }
  ]

  // Persist only the explicitly collapsed projects (see `loadExpanded`).
  $effect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...collapsed]))
  })

  function isExpanded(projectId: string): boolean {
    return q ? true : !collapsed.has(projectId)
  }

  function toggleProject(projectId: string): void {
    if (q) return
    const next = new Set(collapsed)
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    collapsed = next
  }

  function tintFor(projectId: string): string {
    const index = workspace.projects.findIndex((project) => project.id === projectId)
    return ROW_TINTS[(index < 0 ? 0 : index) % ROW_TINTS.length]
  }

  function expand(projectId: string): void {
    if (!collapsed.has(projectId)) return
    const next = new Set(collapsed)
    next.delete(projectId)
    collapsed = next
  }

  async function createProject(): Promise<void> {
    const project = await workspace.createProject()
    expand(project.id)
  }

  async function createPage(projectId?: string): Promise<void> {
    let pid = projectId ?? workspace.activeProjectId ?? workspace.projects[0]?.id
    if (!pid) {
      const project = await workspace.createProject()
      pid = project.id
    }
    expand(pid)
    const page = await workspace.createPage(pid)
    if (page) await navigate('/page/:pageId', { params: { pageId: page.id } })
  }

  function onAdd(id: string): void {
    if (id === 'project') void createProject()
    else void createPage()
  }

  function onProjectMenu(id: string, project: ProjectMeta): void {
    switch (id) {
      case 'new-page':
        void createPage(project.id)
        break
      case 'rename':
        renameProjectTarget = project
        renameProjectName = project.name
        renameProjectOpen = true
        break
      case 'new-project':
        void createProject()
        break
      case 'delete':
        deleteProjectTarget = project
        deleteProjectOpen = true
        break
      default:
        break
    }
  }

  function pageItems(project: ProjectMeta, page: PageMeta) {
    const pages = workspace.pagesFor(project.id)
    const index = pages.findIndex((candidate) => candidate.id === page.id)
    return [
      { id: 'rename', label: 'Rename', icon: ICONS.edit },
      { id: 'duplicate', label: 'Duplicate View', icon: ICONS.duplicate },
      { id: 'up', label: 'Move up', icon: ICONS.chevronUp, disabled: index <= 0, separatorBefore: true },
      {
        id: 'down',
        label: 'Move down',
        icon: ICONS.chevronDown,
        disabled: index < 0 || index >= pages.length - 1
      },
      { id: 'delete', label: 'Delete page', icon: ICONS.delete, danger: true, separatorBefore: true }
    ]
  }

  function onPageMenu(id: string, project: ProjectMeta, page: PageMeta): void {
    switch (id) {
      case 'rename':
        renamePageTarget = page
        renamePageTitle = page.title
        renamePageOpen = true
        break
      case 'duplicate':
        void window.rasuko.view.duplicate(project.id, page.viewId).then(() => workspace.init())
        break
      case 'up':
        movePage(project, page, -1)
        break
      case 'down':
        movePage(project, page, 1)
        break
      case 'delete':
        deletePageTarget = page
        deletePageOpen = true
        break
      default:
        break
    }
  }

  function movePage(project: ProjectMeta, page: PageMeta, delta: number): void {
    const pages = workspace.pagesFor(project.id)
    const index = pages.findIndex((candidate) => candidate.id === page.id)
    const next = index + delta
    if (index < 0 || next < 0 || next >= pages.length) return
    void workspace.movePage(project.id, page.id, next)
  }

  async function confirmRenameProject(): Promise<void> {
    const target = renameProjectTarget
    const name = renameProjectName.trim()
    if (target && name) await workspace.renameProject(target.id, name)
    renameProjectOpen = false
  }

  async function confirmDeleteProject(): Promise<void> {
    const target = deleteProjectTarget
    if (target) await workspace.deleteProject(target.id)
    deleteProjectOpen = false
    await navigateToActivePage()
  }

  async function confirmRenamePage(): Promise<void> {
    const target = renamePageTarget
    const title = renamePageTitle.trim()
    if (target && title) await workspace.renamePage(target.id, title)
    renamePageOpen = false
  }

  async function confirmDeletePage(): Promise<void> {
    const target = deletePageTarget
    if (target) await workspace.deletePage(target.id)
    deletePageOpen = false
    await navigateToActivePage()
  }

  function openPage(page: PageMeta): void {
    void navigate('/page/:pageId', { params: { pageId: page.id } })
  }

  async function navigateToActivePage(): Promise<void> {
    const active = workspace.activePage
    const next = active && !active.trashed ? active : workspace.projects.flatMap((p) => workspace.pagesFor(p.id))[0]
    if (next) await navigate('/page/:pageId', { params: { pageId: next.id } })
    else await navigate('/')
  }

</script>

{#snippet projectMenu(project: ProjectMeta)}
  <DropdownMenu items={projectItems} onselect={(id) => onProjectMenu(id, project)} align="end" class="w-52">
    {#snippet trigger()}
      <IconButton
        icon={ICONS.more}
        label={`Options for ${project.name}`}
        size={14}
        class="size-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/project:opacity-100"
      />
    {/snippet}
  </DropdownMenu>
{/snippet}

<div class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
  <div class="flex shrink-0 items-center gap-1 px-2.5 pb-1.5 pt-2.5">
    <div class="relative min-w-0 flex-1">
      <Icon
        name={ICONS.search}
        size={14}
        class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        bind:value={query}
        placeholder="Search pages…"
        aria-label="Search pages"
        class="h-8 rounded-lg border-0 bg-black/[0.045] pl-7 text-[12.5px] placeholder:text-muted-foreground/80 dark:bg-white/[0.06]"
      />
    </div>
    <DropdownMenu items={addItems} onselect={onAdd} align="end" class="w-44">
      {#snippet trigger()}
        <IconButton icon={ICONS.add} label="New project or page" size={15} />
      {/snippet}
    </DropdownMenu>
  </div>

  <div class="flex shrink-0 items-center justify-between px-3 pb-1 pt-3">
    <span class="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Library</span>
    <IconButton
      icon={ICONS.projectAdd}
      label="New project"
      size={14}
      onclick={() => void createProject()}
    />
  </div>

  <div
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-thin px-1.5 pb-2"
    role="tree"
    aria-label="Projects and pages"
  >
    {#if !workspace.index}
      <div class="flex justify-center py-8">
        <Spinner size={16} label="Loading workspace" />
      </div>
    {:else if empty && !q}
      <EmptyState icon={ICONS.project} title="No projects yet" description="Create a project to start writing.">
        {#snippet action()}
          <Button size="sm" variant="outline" onclick={() => void createProject()}>New project</Button>
        {/snippet}
      </EmptyState>
    {:else if rows.length === 0}
      <p class="px-2 py-6 text-center text-[12px] text-muted-foreground">
        No pages match “{query.trim()}”.
      </p>
    {:else}
      {#each rows as row (row.project.id)}
        {@const expanded = isExpanded(row.project.id)}
        {@const tint = tintFor(row.project.id)}
        <div class="group/project relative">
          <button
            type="button"
            role="treeitem"
            aria-expanded={expanded}
            aria-selected="false"
            aria-label={row.project.name}
            class="flex h-[30px] w-full items-center gap-2 rounded-[var(--row-radius)] px-2 text-left text-[13px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            onclick={() => toggleProject(row.project.id)}
          >
            <Icon
              name={ICONS.chevronRight}
              size={14}
              class={cn('text-muted-foreground transition-transform', expanded && 'rotate-90')}
            />
            <Icon name={row.project.icon ?? ICONS.project} size={16} class={tint} />
            <span class="min-w-0 flex-1 truncate font-medium">{row.project.name}</span>
            {#if row.pages.length > 0}
              <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground transition-opacity group-hover/project:opacity-0">
                {row.pages.length}
              </span>
            {/if}
          </button>
          <div class="absolute right-1 top-1/2 -translate-y-1/2">
            {@render projectMenu(row.project)}
          </div>
        </div>

        {#if expanded}
          <div role="group" class="mb-1">
            {#each row.pages as page (page.id)}
              {@const active = workspace.activePageId === page.id}
              <div class="group/page relative">
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={active}
                  aria-label={page.title}
                  class={cn(
                    'flex h-[30px] w-full items-center gap-2 rounded-[var(--row-radius)] py-0 pl-6 pr-2 text-left text-[13px] transition-colors',
                    active
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
                  )}
                  style={active ? 'box-shadow: var(--shadow-row)' : undefined}
                  onclick={() => openPage(page)}
                >
                  <Icon name={page.icon ?? ICONS.page} size={16} class={tint} />
                  <span class="min-w-0 flex-1 truncate">{page.title}</span>
                </button>
                <div class="absolute right-1 top-1/2 -translate-y-1/2">
                  <DropdownMenu
                    items={pageItems(row.project, page)}
                    onselect={(id) => onPageMenu(id, row.project, page)}
                    align="end"
                    class="w-48"
                  >
                    {#snippet trigger()}
                      <IconButton
                        icon={ICONS.more}
                        label={`Options for ${page.title}`}
                        size={14}
                        class="size-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/page:opacity-100"
                      />
                    {/snippet}
                  </DropdownMenu>
                </div>
              </div>
            {:else}
              <p class="px-3 py-1.5 text-[11.5px] text-muted-foreground">No pages</p>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if providers.configured.length === 0}
    <button
      type="button"
      class="mx-2.5 mb-1 flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--rasuko-accent)]/10 px-2.5 py-1.5 text-left text-[11.5px] text-sidebar-foreground transition-colors hover:bg-[var(--rasuko-accent)]/15"
      onclick={() => void navigate('/settings')}
    >
      <Icon name={ICONS.plug} size={14} class="shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate">Connect a model</span>
    </button>
  {/if}

  <div class="mt-auto flex shrink-0 items-center justify-end gap-1 px-2.5 pb-2.5 pt-2">
    <!-- The active model lives in the assistant composer; the sidebar only
         carries workspace actions, per the design reference. -->
    <div class="flex shrink-0 items-center gap-0.5">
      <Popover bind:open={recentOpen} side="top" align="end" class="w-64">
        {#snippet trigger()}
          <IconButton icon={ICONS.time} label="Recent" size={15} />
        {/snippet}

        <div class="px-1.5 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          Recent
        </div>
        {#each recentPages as page (page.id)}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-accent"
            onclick={() => {
              recentOpen = false
              openPage(page)
            }}
          >
            <Icon name={page.icon ?? ICONS.page} size={14} class={cn('shrink-0', tintFor(page.projectId))} />
            <span class="min-w-0 flex-1 truncate">{page.title}</span>
            <span class="shrink-0 text-[11px] text-muted-foreground">{relativeTime(page.updatedAt)}</span>
          </button>
        {:else}
          <p class="px-2 py-3 text-center text-[12px] text-muted-foreground">No recent pages</p>
        {/each}
      </Popover>

      <IconButton icon={ICONS.settings} label="Settings" onclick={() => void navigate('/settings')} />
    </div>
  </div>
</div>

<Dialog
  bind:open={renameProjectOpen}
  title="Rename project"
  description="The name is only shown in the sidebar."
>
  <Input
    bind:value={renameProjectName}
    placeholder="Project name"
    aria-label="Project name"
    onkeydown={(event) => {
      if (event.key === 'Enter') void confirmRenameProject()
    }}
  />
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => (renameProjectOpen = false)}>Cancel</Button>
    <Button size="sm" onclick={() => void confirmRenameProject()}>Save</Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={deleteProjectOpen}
  title={`Delete “${deleteProjectTarget?.name ?? ''}”?`}
  description="Every page in this project is removed. This cannot be undone."
>
  <p class="text-[12.5px] text-muted-foreground">
    {deleteProjectTarget
      ? `${workspace.pagesFor(deleteProjectTarget.id).length} page(s) will be removed.`
      : ''}
  </p>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => (deleteProjectOpen = false)}>Cancel</Button>
    <Button variant="destructive" size="sm" onclick={() => void confirmDeleteProject()}>Delete project</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={renamePageOpen} title="Rename page" description="Give the page a clearer title.">
  <Input
    bind:value={renamePageTitle}
    placeholder="Page title"
    aria-label="Page title"
    onkeydown={(event) => {
      if (event.key === 'Enter') void confirmRenamePage()
    }}
  />
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => (renamePageOpen = false)}>Cancel</Button>
    <Button size="sm" onclick={() => void confirmRenamePage()}>Save</Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={deletePageOpen}
  title={`Delete “${deletePageTarget?.title ?? ''}”?`}
  description="The page and its View are removed. Content records are kept as unplaced content."
>
  <p class="text-[12.5px] text-muted-foreground">This cannot be undone.</p>
  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => (deletePageOpen = false)}>Cancel</Button>
    <Button variant="destructive" size="sm" onclick={() => void confirmDeletePage()}>Delete page</Button>
  {/snippet}
</Dialog>
