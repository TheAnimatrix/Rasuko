/**
 * Credential encryption via Electron safeStorage.
 *
 * Lazy `require` so this module stays importable outside Electron (tests, CLI)
 * where it degrades to a passthrough codec.
 */

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface SecretCodec {
  canEncrypt(): boolean
  encrypt(plainText: string): string
  decrypt(payload: string): string
}

class PassthroughCodec implements SecretCodec {
  canEncrypt(): boolean {
    return false
  }
  encrypt(plainText: string): string {
    return plainText
  }
  decrypt(payload: string): string {
    return payload
  }
}

class SafeStorageCodec implements SecretCodec {
  constructor(private readonly storage: SafeStorageLike) {}
  canEncrypt(): boolean {
    try {
      return this.storage.isEncryptionAvailable()
    } catch {
      return false
    }
  }
  encrypt(plainText: string): string {
    return this.storage.encryptString(plainText).toString('base64')
  }
  decrypt(payload: string): string {
    return this.storage.decryptString(Buffer.from(payload, 'base64'))
  }
}

export function createSecretCodec(): SecretCodec {
  if (!process.versions.electron) return new PassthroughCodec()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { safeStorage?: SafeStorageLike }
    if (!electron?.safeStorage) return new PassthroughCodec()
    const codec = new SafeStorageCodec(electron.safeStorage)
    return codec.canEncrypt() ? codec : new PassthroughCodec()
  } catch {
    return new PassthroughCodec()
  }
}
