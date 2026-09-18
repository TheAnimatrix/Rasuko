<script lang="ts">
  import PageSurface from '../components/PageSurface.svelte'
  import Spinner from '$lib/components/ui/Spinner.svelte'
  import { route } from '$lib/router'
  import { workspace } from '$lib/stores/workspace.svelte'
  import { untrack } from 'svelte'

  const pageId = $derived(String((route.params as Record<string, string>).pageId ?? ''))

  /**
   * This route owns opening the page. `workspace.init()` deliberately does not,
   * so there is exactly one owner and no race between two concurrent loads.
   *
   * A cold start can still land before the workspace index is ready, so a short
   * bounded retry keeps the surface from sticking on a spinner.
   */
  $effect(() => {
    const id = pageId
    if (!id || workspace.loading) return
    let cancelled = false
    let attempts = 0

    const load = async () => {
      if (cancelled) return
      attempts += 1
      await workspace.openPage(id)
      if (cancelled) return
      if (workspace.payload?.page.id !== id && attempts < 12) {
        setTimeout(load, 150)
      }
    }

    // Only a URL change opens a page. Workspace updates must never reopen an
    // old route while a new page is being created or a sidebar click navigates.
    untrack(() => void load())
    return () => {
      cancelled = true
    }
  })
</script>

{#if pageId && workspace.payload?.page.id === pageId}
  <PageSurface {pageId} />
{:else}
  <div class="flex flex-1 items-center justify-center">
    <Spinner size={18} label="Opening page" />
  </div>
{/if}
