import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { applyRecordAction, type RecordAction, type RecordActionReceipt } from '@shared/recordActions'
import type { ContentRecord } from '@shared/types'
import { isId, ulid } from '@shared/ids'
import { atomicWriteJsonSync, readJsonSync } from '../io/atomic'
import { projectDir } from '../paths'
import type { WorkspaceStore } from './WorkspaceStore'

interface Entry {
  id: string
  action: RecordAction['type']
  summary: string
  affectedId?: string
  before: ContentRecord
  after: ContentRecord
  state: 'pending' | 'committed' | 'undoing' | 'undone' | 'superseded'
  undoRevision?: number
}
interface Journal { version: 1; entries: Entry[] }

function fingerprint(record: ContentRecord): string {
  const { updatedAt: _time, revision: _revision, schemaVersion: _schema, ...data } = record
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
      : value
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex')
}

/**
 * Actions read and patch the current record synchronously in the main process.
 * The write-ahead journal is durable before content changes. A crash between
 * record and receipt writes is resolved from revision + content on next access.
 * Undo refuses to overwrite any intervening edit, including an ordinary file edit.
 */
export class RecordActionService {
  constructor(private readonly workspace: WorkspaceStore) {}

  private path(projectId: string, recordId: string): string {
    if (!isId(projectId, 'project') || !isId(recordId, 'record')) throw new Error('Invalid action target IDs')
    return join(projectDir(projectId), '.history', `${recordId}.actions.json`)
  }

  private load(projectId: string, record: ContentRecord): Journal {
    const path = this.path(projectId, record.id)
    const loaded = readJsonSync<Journal>(path)
    if (!loaded && existsSync(path)) throw new Error('Action history is unreadable; its original file has been preserved')
    const journal = loaded ?? { version: 1, entries: [] }
    if (journal.version !== 1 || !Array.isArray(journal.entries)) throw new Error('Action history is unreadable; preserve the history file before repairing it')
    let changed = false
    for (const entry of journal.entries) {
      if (entry.state === 'pending') {
        entry.state = record.revision === entry.after.revision && fingerprint(record) === fingerprint(entry.after) ? 'committed' : 'superseded'
        changed = true
      } else if (entry.state === 'undoing') {
        if (record.revision === entry.undoRevision && fingerprint(record) === fingerprint(entry.before)) {
          entry.state = 'undone'
          this.rebasePrevious(journal, entry, record)
        } else entry.state = record.revision === entry.after.revision && fingerprint(record) === fingerprint(entry.after) ? 'committed' : 'superseded'
        changed = true
      }
    }
    if (changed) atomicWriteJsonSync(path, journal)
    return journal
  }

  execute(projectId: string, recordId: string, action: RecordAction, expectedRevision?: number): RecordActionReceipt {
    const path = this.path(projectId, recordId)
    const before = this.workspace.getRecord(projectId, recordId)
    if (!before) throw new Error('Record not found')
    if (expectedRevision !== undefined && (before.revision ?? 0) !== expectedRevision) throw new Error(`REVISION_CONFLICT: record changed (expected ${expectedRevision}, current ${before.revision ?? 0}). Reload and retry`)
    const result = applyRecordAction(before, action)
    const journal = this.load(projectId, before)
    const entry: Entry = { id: ulid(), action: action.type, summary: result.summary, affectedId: result.affectedId, before, after: { ...result.record, schemaVersion: 1, revision: (before.revision ?? 0) + 1 }, state: 'pending' }
    journal.entries.push(entry)
    // Keep the most recent 100 action snapshots as a bounded undo window.
    if (journal.entries.length > 100) journal.entries = journal.entries.slice(-100)
    atomicWriteJsonSync(path, journal)
    const updated = this.workspace.updateRecord(projectId, recordId, result.record, before.revision ?? 0)
    if (!updated) throw new Error('Record disappeared before the action could be saved')
    entry.after = updated
    entry.state = 'committed'
    atomicWriteJsonSync(path, journal)
    return { id: entry.id, action: entry.action, summary: entry.summary, affectedId: entry.affectedId, record: updated, canUndo: true }
  }

  undo(projectId: string, recordId: string): RecordActionReceipt | null {
    const path = this.path(projectId, recordId)
    const current = this.workspace.getRecord(projectId, recordId)
    if (!current) throw new Error('Record not found')
    const journal = this.load(projectId, current)
    const entry = [...journal.entries].reverse().find((entry) => entry.state === 'committed')
    if (!entry) return null
    if (current.revision !== entry.after.revision || fingerprint(current) !== fingerprint(entry.after)) throw new Error('This record changed after the action. Undo would overwrite newer edits; reload and review those edits first')
    entry.state = 'undoing'
    entry.undoRevision = (current.revision ?? 0) + 1
    atomicWriteJsonSync(path, journal)
    const restored = this.workspace.updateRecord(projectId, recordId, { ...entry.before, revision: current.revision }, current.revision ?? 0)
    if (!restored) throw new Error('Record disappeared before undo could be saved')
    entry.state = 'undone'
    this.rebasePrevious(journal, entry, restored)
    atomicWriteJsonSync(path, journal)
    const previous = [...journal.entries].reverse().find((item) => item.state === 'committed')
    const canUndo = Boolean(previous && previous.after.revision === restored.revision && fingerprint(previous.after) === fingerprint(restored))
    return { id: entry.id, action: 'undo', summary: `Undid: ${entry.summary}`, affectedId: entry.affectedId, record: restored, canUndo }
  }

  private rebasePrevious(journal: Journal, undone: Entry, restored: ContentRecord): void {
    const index = journal.entries.indexOf(undone)
    const previous = journal.entries.slice(0, index).reverse().find((entry) => entry.state === 'committed')
    if (previous && fingerprint(previous.after) === fingerprint(restored)) previous.after = restored
  }
}
