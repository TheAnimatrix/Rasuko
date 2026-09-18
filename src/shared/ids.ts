/**
 * Stable, sortable, human-greppable IDs.
 *
 * Format: `<prefix>_<26-char crockford base32 ulid>`
 *   rec_01J8Z9K3M4N5P6Q7R8S9T0V1W2
 *
 * IDs are the backbone of Rasuko: content records outlive the Views that display
 * them, so IDs must be stable across redesigns, clients and exports.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeTime(time: number, length: number): string {
  let out = ''
  for (let i = length - 1; i >= 0; i -= 1) {
    const mod = time % 32
    out = CROCKFORD[mod] + out
    time = (time - mod) / 32
  }
  return out
}

function encodeRandom(length: number): string {
  const bytes = new Uint8Array(length)
  const cryptoObj = globalThis.crypto
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < length; i += 1) out += CROCKFORD[bytes[i] % 32]
  return out
}

/** Monotonic within a millisecond so IDs created in a loop still sort. */
let lastTime = 0
let lastRandom = ''

export function ulid(): string {
  const now = Date.now()
  if (now === lastTime && lastRandom) {
    const chars = lastRandom.split('')
    for (let i = chars.length - 1; i >= 0; i -= 1) {
      const idx = CROCKFORD.indexOf(chars[i])
      if (idx < 31) {
        chars[i] = CROCKFORD[idx + 1]
        lastRandom = chars.join('')
        return encodeTime(now, 10) + lastRandom
      }
      chars[i] = CROCKFORD[0]
    }
  }
  lastTime = now
  lastRandom = encodeRandom(16)
  return encodeTime(now, 10) + lastRandom
}

export const ID_PREFIXES = {
  project: 'prj',
  page: 'pg',
  view: 'vw',
  node: 'nd',
  record: 'rec',
  block: 'blk',
  chat: 'cht',
  message: 'msg',
  turn: 'tun'
} as const

export type IdKind = keyof typeof ID_PREFIXES

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${ulid()}`
}

export function isId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== 'string') return false
  const prefix = kind ? ID_PREFIXES[kind] : null
  if (!prefix) return /^[a-z]{2,4}_[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
  return new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(value)
}

/** Deterministic short label for UI: `rec_01J8Z9K3…` */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id
}

export function nowIso(): string {
  return new Date().toISOString()
}
