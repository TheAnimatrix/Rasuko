import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { authPath } from '../paths'
import { atomicWriteFileSync, quarantineSync, readJsonSync } from '../io/atomic'
import { createSecretCodec, type SecretCodec } from './secretCodec'

const ENVELOPE_KEY = '__rasuko_encrypted_v1'

interface EncryptedEnvelope {
  [ENVELOPE_KEY]: string
}

type FileShape = Record<string, Credential> | EncryptedEnvelope

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  return Boolean(value && typeof value === 'object' && ENVELOPE_KEY in (value as object))
}

/**
 * File-backed pi-ai CredentialStore.
 * - one credential per provider id
 * - serialized read-modify-write per provider
 * - safeStorage-encrypted at rest when available
 * - corrupt files are quarantined, never deleted
 */
export class FileCredentialStore implements CredentialStore {
  private credentials = new Map<string, Credential>()
  private chains = new Map<string, Promise<unknown>>()
  private loaded = false

  constructor(
    private readonly path: string = authPath(),
    private readonly codec: SecretCodec = createSecretCodec()
  ) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    const raw = readJsonSync<FileShape>(this.path)
    if (!raw) return
    let decoded: unknown = raw
    if (isEnvelope(raw)) {
      try {
        decoded = JSON.parse(this.codec.decrypt(raw[ENVELOPE_KEY]))
      } catch {
        quarantineSync(this.path)
        return
      }
    }
    if (!decoded || typeof decoded !== 'object') return
    for (const [providerId, credential] of Object.entries(decoded as Record<string, Credential>)) {
      if (credential && typeof credential === 'object' && 'type' in credential) {
        this.credentials.set(providerId, credential)
      }
    }
  }

  private persist(): void {
    const payload = JSON.stringify(Object.fromEntries(this.credentials))
    const body = this.codec.canEncrypt()
      ? JSON.stringify({ [ENVELOPE_KEY]: this.codec.encrypt(payload) }, null, 2)
      : JSON.stringify(Object.fromEntries(this.credentials), null, 2)
    atomicWriteFileSync(this.path, `${body}\n`, { mode: 0o600 })
  }

  private enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    this.chains.set(
      key,
      next.catch(() => undefined)
    )
    return next
  }

  async read(providerId: string): Promise<Credential | undefined> {
    this.load()
    return this.credentials.get(providerId)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    this.load()
    return [...this.credentials.entries()].map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      this.load()
      const current = this.credentials.get(providerId)
      const next = await fn(current)
      if (next !== undefined) {
        this.credentials.set(providerId, next)
        this.persist()
      }
      return next
    })
  }

  async delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      this.load()
      if (this.credentials.delete(providerId)) this.persist()
    })
  }

  isEncryptedAtRest(): boolean {
    return this.codec.canEncrypt()
  }

  /** Sync provider-id listing for catalog building on hot paths. */
  listProviderIdsSync(): string[] {
    this.load()
    return [...this.credentials.keys()]
  }

  /** Sync read used by the resolve path; mirrors pi-ai's async `read`. */
  readSync(providerId: string): Credential | undefined {
    this.load()
    return this.credentials.get(providerId)
  }
}
