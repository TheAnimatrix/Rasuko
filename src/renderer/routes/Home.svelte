<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Spinner from '$lib/components/ui/Spinner.svelte'
  import { ICONS } from '$lib/icon-names'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { navigate } from '$lib/router'

  /**
   * The blank canvas. Rasuko opens on a page; this route only exists as the
   * landing state before a page has been created or selected.
   */
  let navigating = $state(false)

  $effect(() => {
    if (workspace.loading) return
    const pageId = workspace.activePageId
    if (!pageId) return
    navigating = true
    void navigate('/page/:pageId', { params: { pageId }, replace: true }).finally(() => {
      navigating = false
    })
  })

  async function createFirstPage() {
    let projectId = workspace.projects[0]?.id
    if (!projectId) {
      const project = await workspace.createProject('My Workspace')
      projectId = project.id
    }
    const page = await workspace.createPage(projectId, { title: 'Notes' })
    if (page) void navigate('/page/:pageId', { params: { pageId: page.id } })
  }
</script>

<div class="flex h-full flex-1 items-center justify-center px-8">
  {#if workspace.loading || navigating}
    <Spinner size={18} label="Loading workspace" />
  {:else}
    <div class="w-full max-w-sm text-center">
      <span class="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <Icon name={ICONS.document} size={20} />
      </span>
      <h1 class="text-[15px] font-medium tracking-tight">A blank canvas</h1>
      <p class="mx-auto mt-1.5 max-w-xs text-[12.5px] text-muted-foreground text-pretty">
        Every page is a View. Write freely now, or ask the assistant to shape it into a tracker,
        a dashboard or a form later — your content stays put either way.
      </p>
      <div class="mt-5 flex items-center justify-center gap-2">
        <Button onclick={createFirstPage}>
          <Icon name={ICONS.pageAdd} size={14} />
          New page
        </Button>
      </div>
    </div>
  {/if}
</div>
