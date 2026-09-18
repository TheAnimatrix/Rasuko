import type { RecordAction, RecordActionReceipt } from '@shared/recordActions'
import { workspace } from '$lib/stores/workspace.svelte'

const queues = new Map<string, Promise<unknown>>()
const pending = new Set<Promise<unknown>>()

function key(projectId: string | undefined, recordId: string): string {
  return `${projectId ?? ''}\u0000${recordId}`
}

function track<T>(operation: Promise<T>, queueKey: string): Promise<T> {
  pending.add(operation)
  void operation.then(
    () => { pending.delete(operation); if (queues.get(queueKey) === operation) queues.delete(queueKey) },
    () => { pending.delete(operation); if (queues.get(queueKey) === operation) queues.delete(queueKey) }
  )
  return operation
}

export function runQueuedRecordAction(recordId: string, action: RecordAction, projectId?: string): Promise<RecordActionReceipt> {
  const queueKey = key(projectId, recordId)
  const previous = queues.get(queueKey) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(() => workspace.runRecordAction(recordId, action, projectId))
  queues.set(queueKey, operation)
  return track(operation, queueKey)
}

export function undoQueuedRecordAction(recordId: string, projectId?: string): Promise<RecordActionReceipt | null> {
  const queueKey = key(projectId, recordId)
  const previous = queues.get(queueKey) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(() => workspace.undoRecordAction(recordId, projectId))
  queues.set(queueKey, operation)
  return track(operation, queueKey)
}

export function waitForRecordActions(): Promise<void> | undefined {
  return pending.size ? Promise.all([...pending]).then(() => undefined) : undefined
}

async function drainRecordActions(): Promise<void> {
  // Yield once so component flush listeners can enqueue their active drafts,
  // even when this module's listener was registered first.
  await Promise.resolve()
  while (pending.size) await Promise.all([...pending])
}

if (typeof window !== 'undefined') {
  window.addEventListener('rasuko:flush-editors', (event) => {
    ;(event as CustomEvent<{ waitUntil?: (promise: Promise<unknown>) => void }>).detail?.waitUntil?.(drainRecordActions())
  })
}
