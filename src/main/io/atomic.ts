import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Atomic file writes. Windows rename can transiently fail with EPERM/EBUSY when
 * an indexer or antivirus holds the target, so we retry with backoff and fall
 * back to a copy-replace.
 */

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY'])
const BACKOFF_MS = [10, 25, 50, 100, 200, 400]

function isRetryable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && RETRYABLE.has(String((error as { code?: string }).code)))
}

function sleep(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* spin — these pauses are sub-second and only on contention */
  }
}

function retry<T>(fn: () => T): T {
  let lastError: unknown
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    try {
      return fn()
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt === BACKOFF_MS.length) break
      sleep(BACKOFF_MS[attempt])
    }
  }
  throw lastError
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

export interface WriteOptions {
  mode?: number
  fsync?: boolean
}

export function atomicWriteFileSync(path: string, data: string, options: WriteOptions = {}): void {
  const dir = dirname(path)
  ensureDir(dir)
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  const handle = openSync(tmp, 'w', options.mode ?? 0o600)
  try {
    writeFileSync(handle, data, 'utf-8')
    if (options.fsync !== false) fsyncSync(handle)
  } finally {
    closeSync(handle)
  }

  try {
    try {
      retry(() => renameSync(tmp, path))
    } catch (error) {
      if (!isRetryable(error)) throw error
      retry(() => copyFileSync(tmp, path))
    }
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* best effort */
    }
  }

  if (options.mode !== undefined) {
    try {
      chmodSync(path, options.mode)
    } catch {
      /* chmod is a no-op on Windows for most cases */
    }
  }
}

export function atomicWriteJsonSync(path: string, data: unknown, options: WriteOptions = {}): void {
  atomicWriteFileSync(path, `${JSON.stringify(data, null, 2)}\n`, options)
}

export function readJsonSync<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

/** Move an unreadable file aside instead of destroying it. */
export function quarantineSync(path: string): string | null {
  if (!existsSync(path)) return null
  const target = `${path}.corrupt-${Date.now()}`
  try {
    renameSync(path, target)
    return target
  } catch {
    return null
  }
}

export function readTextSync(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}
