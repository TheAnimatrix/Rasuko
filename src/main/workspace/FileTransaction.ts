import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDir, readJsonSync } from '../io/atomic'

export type FileMutation = { path: string; contents: string } | { path: string; delete: true }
export interface FileCheckpointEntry { path: string; existed: boolean; backup?: string; beforeHash: string | null; afterHash: string | null }
export interface FileCheckpoint { format: 'rasuko-file-checkpoint-v1'; id: string; label: string; createdAt: string; entries: FileCheckpointEntry[]; committed: boolean; restoredAt?: string }
export interface RecoveryResult { restored: string[]; conflicts: Array<{ id: string; reason: string }> }

const hash = (contents: string | Buffer): string => createHash('sha256').update(contents).digest('hex')
const fileHash = (path: string): string | null => existsSync(path) ? hash(readFileSync(path)) : null
export const jsonContents = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

function assertInside(root: string, path: string): string {
  const absoluteRoot = resolve(root)
  const absolute = resolve(path)
  const rel = relative(absoluteRoot, absolute)
  if (!rel || rel.startsWith('..') || resolve(absoluteRoot, rel) !== absolute) throw new Error(`Transaction path must be a file below ${absoluteRoot}`)
  return absolute
}

function loadTrustedCheckpoint(root: string, id: string): { checkpoint: FileCheckpoint; dir: string; manifestPath: string } {
  if (!/^\d{10,}-[a-f0-9]{16}$/.test(id)) throw new Error('Invalid checkpoint id')
  const dir = join(resolve(root), '.checkpoints', id)
  const manifestPath = join(dir, 'manifest.json')
  const checkpoint = readJsonSync<FileCheckpoint>(manifestPath)
  if (!checkpoint || checkpoint.format !== 'rasuko-file-checkpoint-v1' || checkpoint.id !== id || !Array.isArray(checkpoint.entries)) throw new Error(`Checkpoint ${id} is missing or invalid`)
  checkpoint.entries.forEach((entry, index) => {
    assertInside(root, entry.path)
    if (entry.existed) {
      const expected = join(dir, 'before', `${index}-${basename(entry.path)}`)
      if (!entry.backup || resolve(entry.backup) !== resolve(expected)) throw new Error(`Checkpoint ${id} has an invalid backup path`)
      assertInside(dir, entry.backup)
      if (!existsSync(entry.backup) || fileHash(entry.backup) !== entry.beforeHash) throw new Error(`Checkpoint backup is missing or damaged for ${entry.path}`)
    } else if (entry.backup) throw new Error(`Checkpoint ${id} has an unexpected backup`)
    if (entry.beforeHash !== null && !/^[a-f0-9]{64}$/.test(entry.beforeHash)) throw new Error(`Checkpoint ${id} has an invalid before hash`)
    if (entry.afterHash !== null && !/^[a-f0-9]{64}$/.test(entry.afterHash)) throw new Error(`Checkpoint ${id} has an invalid after hash`)
  })
  return { checkpoint, dir, manifestPath }
}

/** Durable, recoverable multi-file publication. It is intentionally not described as OS-level atomic. */
export function commitFileTransaction(root: string, label: string, mutations: FileMutation[]): FileCheckpoint {
  if (mutations.length === 0) throw new Error('Transaction requires at least one mutation')
  const id = `${Date.now()}-${randomBytes(8).toString('hex')}`
  const checkpointDir = join(resolve(root), '.checkpoints', id)
  const backupDir = join(checkpointDir, 'before')
  const manifestPath = join(checkpointDir, 'manifest.json')
  ensureDir(backupDir)
  const seen = new Set<string>()
  const normalized = mutations.map((mutation, index) => {
    const path = assertInside(root, mutation.path)
    if (seen.has(path)) throw new Error(`Transaction contains duplicate path ${path}`)
    seen.add(path)
    const existed = existsSync(path)
    const beforeHash = fileHash(path)
    const backup = existed ? join(backupDir, `${index}-${basename(path)}`) : undefined
    if (backup) copyFileSync(path, backup)
    const afterHash = 'delete' in mutation ? null : hash(mutation.contents)
    return { mutation: { ...mutation, path }, entry: { path, existed, backup, beforeHash, afterHash } satisfies FileCheckpointEntry }
  })
  const checkpoint: FileCheckpoint = { format: 'rasuko-file-checkpoint-v1', id, label, createdAt: new Date().toISOString(), entries: normalized.map(({ entry }) => entry), committed: false }
  atomicWriteJsonSync(manifestPath, checkpoint)
  try {
    for (const { mutation, entry } of normalized) {
      if (fileHash(mutation.path) !== entry.beforeHash) throw new Error(`Transaction conflict: ${mutation.path} changed while the transaction was prepared`)
      if ('delete' in mutation) rmSync(mutation.path, { force: true })
      else atomicWriteFileSync(mutation.path, mutation.contents)
    }
    checkpoint.committed = true
    atomicWriteJsonSync(manifestPath, checkpoint)
    return checkpoint
  } catch (error) {
    restoreFileCheckpoint(root, id)
    throw error
  }
}

export function restoreFileCheckpoint(root: string, id: string): FileCheckpoint {
  const { checkpoint, manifestPath } = loadTrustedCheckpoint(root, id)
  if (checkpoint.restoredAt) return checkpoint
  for (const entry of checkpoint.entries) {
    const current = fileHash(entry.path)
    const allowed = checkpoint.committed ? current === entry.afterHash : current === entry.beforeHash || current === entry.afterHash
    if (!allowed) throw new Error(`Checkpoint ${id} cannot restore ${entry.path}: it was changed after the checkpoint`)
  }
  for (const entry of [...checkpoint.entries].reverse()) {
    if (entry.existed) { ensureDir(dirname(entry.path)); atomicWriteFileSync(entry.path, readFileSync(entry.backup!, 'utf8')) }
    else rmSync(entry.path, { force: true })
  }
  checkpoint.restoredAt = new Date().toISOString()
  atomicWriteJsonSync(manifestPath, checkpoint)
  return checkpoint
}

export function listFileCheckpoints(root: string): FileCheckpoint[] {
  const dir = join(resolve(root), '.checkpoints')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((id) => { try { return [loadTrustedCheckpoint(root, id).checkpoint] } catch { return [] } }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function recoverIncompleteFileTransactions(root: string): RecoveryResult {
  const result: RecoveryResult = { restored: [], conflicts: [] }
  for (const checkpoint of listFileCheckpoints(root)) {
    if (checkpoint.committed || checkpoint.restoredAt) continue
    try { restoreFileCheckpoint(root, checkpoint.id); result.restored.push(checkpoint.id) }
    catch (error) { result.conflicts.push({ id: checkpoint.id, reason: error instanceof Error ? error.message : 'recovery failed' }) }
  }
  return result
}
