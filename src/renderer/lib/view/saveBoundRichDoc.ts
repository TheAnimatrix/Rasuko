import type { ContentRecord } from '@shared/types'
import type { RichDoc } from '@shared/richtext'
import { mergeProjectedBlocks } from '$lib/editor/blockModel'

export interface BoundRichTarget {
  projectId: string
  recordId: string
  blockIds: readonly string[]
  viewId?: string
  nodeId?: string
}

const queues = new Map<string, Promise<void>>()

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Serialize writes per physical record and merge against a fresh disk read.
 * Several custom View projections may edit one record at once; queueing avoids
 * two debounced snapshots overwriting each other's hidden blocks.
 */
export function saveBoundRichDoc(target: BoundRichTarget, projection: RichDoc): Promise<void> {
  const key = `${target.projectId}\u0000${target.recordId}`
  const previous = queues.get(key) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const fresh = await window.rasuko.records.get(target.projectId, target.recordId)
    if (!fresh || fresh.kind !== 'richtext') return

    const doc = target.blockIds.length
      ? mergeProjectedBlocks(fresh.doc, projection, target.blockIds)
      : projection
    await window.rasuko.records.update(target.projectId, target.recordId, { doc } as Partial<ContentRecord>)

    // Splitting, inserting or deleting inside a projected editor changes the
    // projection itself. Persist those IDs so new content remains visible.
    const nextIds = projection.blocks.map((block) => block.id)
    if (
      target.blockIds.length > 0 &&
      !sameIds(target.blockIds, nextIds) &&
      target.viewId &&
      target.nodeId
    ) {
      await window.rasuko.view.applyOps(target.projectId, target.viewId, [
        {
          op: 'setBind',
          target: target.nodeId,
          bind: { recordId: target.recordId, blockIds: nextIds }
        }
      ])
    }
  })

  queues.set(key, operation)
  const cleanup = (): void => {
    if (queues.get(key) === operation) queues.delete(key)
  }
  void operation.then(cleanup, cleanup)
  return operation
}
