/** Every editor contributes its pending write; rejection keeps the current page open. */
export async function flushEditors(): Promise<void> {
  const writes: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent('rasuko:flush-editors', {
    detail: { waitUntil: (write: Promise<unknown>) => writes.push(write) }
  }))
  try {
    await Promise.all(writes)
  } catch (error) {
    window.dispatchEvent(new CustomEvent('rasuko:save-error', { detail: error instanceof Error ? error.message : 'Could not save your changes. Retry before leaving this page.' }))
    throw error
  }
}
