import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from '@earendil-works/pi-ai'

export type LoginEvent =
  | { type: 'loading'; message?: string }
  | { type: 'progress'; message: string }
  | { type: 'info'; message: string; links?: Array<{ url: string; label?: string }> }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: 'prompt'; promptType: 'text' | 'secret'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string; description?: string }> }
  | { type: 'manual_code'; message: string; placeholder?: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type LoginResponse =
  | { kind: 'prompt'; value: string }
  | { kind: 'select'; value: string }
  | { kind: 'manual_code'; value: string }
  | { kind: 'cancel' }

interface Pending {
  resolve: (value: string) => void
  reject: (error: Error) => void
  kind: 'prompt' | 'select' | 'manual_code'
}

/**
 * Bridges pi-ai's imperative auth callbacks to the renderer over IPC.
 * Ported in spirit from the Mousse project, reduced to what Rasuko needs.
 */
export class LoginSession {
  private pending: Pending | null = null
  readonly abort = new AbortController()
  readonly startedAt = Date.now()

  constructor(
    readonly sessionId: string,
    readonly providerId: string,
    private readonly send: (event: LoginEvent) => void
  ) {}

  private emit(event: LoginEvent): void {
    this.send(event)
  }

  createAuthCallbacks(): ProviderAuthInteraction {
    return {
      signal: this.abort.signal,
      prompt: (prompt: AuthPrompt) => {
        if (prompt.type === 'select') {
          this.emit({
            type: 'select',
            message: prompt.message,
            options: prompt.options.map((o) => ({ id: o.id, label: o.label, description: o.description }))
          })
          return this.wait('select')
        }
        if (prompt.type === 'manual_code') {
          this.emit({ type: 'manual_code', message: prompt.message, placeholder: prompt.placeholder })
          return this.wait('manual_code')
        }
        this.emit({
          type: 'prompt',
          promptType: prompt.type === 'secret' ? 'secret' : 'text',
          message: prompt.message,
          placeholder: prompt.placeholder
        })
        return this.wait('prompt')
      },
      notify: (event: AuthEvent) => {
        if (event.type === 'auth_url') {
          this.emit({ type: 'auth_url', url: event.url, instructions: event.instructions })
        } else if (event.type === 'device_code') {
          this.emit({
            type: 'device_code',
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds
          })
        } else if (event.type === 'progress') {
          this.emit({ type: 'progress', message: event.message })
        } else if (event.type === 'info') {
          this.emit({
            type: 'info',
            message: event.message,
            links: event.links ? event.links.map((l) => ({ url: l.url, label: l.label })) : undefined
          })
        }
      }
    }
  }

  private wait(kind: Pending['kind']): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject, kind }
      this.abort.signal.addEventListener(
        'abort',
        () => {
          this.pending = null
          reject(new Error('Login cancelled'))
        },
        { once: true }
      )
    })
  }

  respond(response: LoginResponse): void {
    if (response.kind === 'cancel') {
      this.abort.abort()
      return
    }
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.resolve(response.value)
  }

  finish(): void {
    this.emit({ type: 'done' })
  }

  fail(message: string): void {
    this.emit({ type: 'error', message })
  }

  cancel(): void {
    this.abort.abort()
  }

  get done(): boolean {
    return this.abort.signal.aborted
  }
}
