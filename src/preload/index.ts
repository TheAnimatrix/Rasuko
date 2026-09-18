import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ChatStreamEvent } from '@shared/ipc'
import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  ContentRecord,
  OpReceipt,
  PageMeta,
  ProjectMeta,
  ViewDoc,
  WorkspaceIndex
} from '@shared/types'
import type { RasukoSettings, RasukoSettingsUpdate, ProviderCatalog, ModelOption } from '@shared/settings'
import type { ApplyResult, ViewOp } from '@shared/viewOps'
import type { RecordAction, RecordActionReceipt } from '@shared/recordActions'

export interface WorkspaceSnapshot {
  index: WorkspaceIndex
  activePageId: string | null
}

export interface PagePayload {
  page: PageMeta
  view: ViewDoc
  records: Record<string, ContentRecord>
  orphaned: ContentRecord[]
}

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

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api = {
  platform: process.platform,

  app: {
    info: () =>
      ipcRenderer.invoke(IPC.app.info) as Promise<{
        name: string
        version: string
        platform: string
        encryptedCredentials: boolean
        home: string
      }>
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.window.minimize) as Promise<void>,
    maximize: () => ipcRenderer.invoke(IPC.window.maximize) as Promise<boolean>,
    close: () => ipcRenderer.invoke(IPC.window.close) as Promise<void>,
    onFlushRequest: (cb: (token: string) => void) => subscribe<string>(IPC.window.flushRequest, cb),
    finishClose: (token: string, saved: boolean) => ipcRenderer.send(IPC.window.flushResult, token, saved),
    isMaximized: () => ipcRenderer.invoke(IPC.window.isMaximized) as Promise<boolean>,
    setThemeBackground: (hex: string) => ipcRenderer.invoke(IPC.window.setThemeBackground, hex) as Promise<void>,
    onMaximizedChange: (cb: (value: boolean) => void) => subscribe<boolean>(IPC.window.maximizedChanged, cb)
  },

  workspace: {
    snapshot: () => ipcRenderer.invoke(IPC.workspace.snapshot) as Promise<WorkspaceSnapshot>,
    onChanged: (cb: (snapshot: WorkspaceSnapshot) => void) => subscribe(IPC.workspace.changed, cb),
    createProject: (name?: string) => ipcRenderer.invoke(IPC.workspace.createProject, name) as Promise<ProjectMeta>,
    updateProject: (id: string, patch: Partial<ProjectMeta>) =>
      ipcRenderer.invoke(IPC.workspace.updateProject, id, patch) as Promise<ProjectMeta | null>,
    deleteProject: (id: string) => ipcRenderer.invoke(IPC.workspace.deleteProject, id) as Promise<boolean>,
    createPage: (projectId: string, init: { title?: string; markdown?: boolean; viewId?: string }) =>
      ipcRenderer.invoke(IPC.workspace.createPage, projectId, init) as Promise<PagePayload | null>,
    updatePage: (pageId: string, patch: Partial<PageMeta>) =>
      ipcRenderer.invoke(IPC.workspace.updatePage, pageId, patch) as Promise<PageMeta | null>,
    deletePage: (pageId: string, hard?: boolean) =>
      ipcRenderer.invoke(IPC.workspace.deletePage, pageId, hard) as Promise<boolean>,
    movePage: (projectId: string, pageId: string, index: number) =>
      ipcRenderer.invoke(IPC.workspace.movePage, projectId, pageId, index) as Promise<void>,
    openPage: (pageId: string) => ipcRenderer.invoke(IPC.workspace.openPage, pageId) as Promise<PagePayload | null>,
    pagePayload: (pageId: string) =>
      ipcRenderer.invoke(IPC.workspace.pagePayload, pageId) as Promise<PagePayload | null>
  },

  records: {
    get: (projectId: string, recordId: string) =>
      ipcRenderer.invoke(IPC.records.get, projectId, recordId) as Promise<ContentRecord | null>,
    list: (projectId: string) => ipcRenderer.invoke(IPC.records.list, projectId) as Promise<ContentRecord[]>,
    create: (projectId: string, record: ContentRecord, pageId?: string) =>
      ipcRenderer.invoke(IPC.records.create, projectId, record, pageId) as Promise<ContentRecord>,
    update: (projectId: string, recordId: string, patch: Partial<ContentRecord>, expectedRevision?: number) =>
      ipcRenderer.invoke(IPC.records.update, projectId, recordId, patch, expectedRevision) as Promise<ContentRecord | null>,
    action: (projectId: string, recordId: string, action: RecordAction, expectedRevision?: number) =>
      ipcRenderer.invoke(IPC.records.action, projectId, recordId, action, expectedRevision) as Promise<RecordActionReceipt>,
    undoAction: (projectId: string, recordId: string) =>
      ipcRenderer.invoke(IPC.records.undoAction, projectId, recordId) as Promise<RecordActionReceipt | null>,
    renameField: (projectId: string, recordId: string, fieldId: string, name: string, expectedRevision?: number) =>
      ipcRenderer.invoke(IPC.records.renameField, projectId, recordId, fieldId, name, expectedRevision) as Promise<ContentRecord | null>,
    delete: (projectId: string, recordId: string) =>
      ipcRenderer.invoke(IPC.records.delete, projectId, recordId) as Promise<boolean>,
    reattach: (projectId: string, viewId: string, recordId: string, nodeId: string) =>
      ipcRenderer.invoke(IPC.records.reattach, projectId, viewId, recordId, nodeId) as Promise<ApplyResult | null>
  },

  view: {
    get: (projectId: string, viewId: string) =>
      ipcRenderer.invoke(IPC.view.get, projectId, viewId) as Promise<ViewDoc | null>,
    list: (projectId: string) => ipcRenderer.invoke(IPC.view.list, projectId) as Promise<ViewDoc[]>,
    save: (projectId: string, view: ViewDoc, expectedRevision?: number) =>
      ipcRenderer.invoke(IPC.view.save, projectId, view, expectedRevision) as Promise<ViewDoc>,
    applyOps: (projectId: string, viewId: string, ops: ViewOp[], summary?: string, expectedRevision?: number) =>
      ipcRenderer.invoke(IPC.view.applyOps, projectId, viewId, ops, summary, expectedRevision) as Promise<ApplyResult | null>,
    create: (projectId: string, name?: string) =>
      ipcRenderer.invoke(IPC.view.create, projectId, name) as Promise<ViewDoc>,
    duplicate: (projectId: string, viewId: string, name?: string) =>
      ipcRenderer.invoke(IPC.view.duplicate, projectId, viewId, name) as Promise<ViewDoc | null>,
    remove: (projectId: string, viewId: string) =>
      ipcRenderer.invoke(IPC.view.remove, projectId, viewId) as Promise<boolean>,
    exportView: (projectId: string, viewId: string) =>
      ipcRenderer.invoke(IPC.view.export, projectId, viewId) as Promise<string | null>
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get) as Promise<RasukoSettings>,
    set: (patch: RasukoSettingsUpdate) =>
      ipcRenderer.invoke(IPC.settings.set, patch) as Promise<RasukoSettings>,
    catalog: () => ipcRenderer.invoke(IPC.settings.catalog) as Promise<ProviderCatalog>,
    onChanged: (cb: (settings: RasukoSettings) => void) => subscribe(IPC.settings.changed, cb)
  },

  providers: {
    list: () => ipcRenderer.invoke(IPC.providers.list) as Promise<ProviderCatalog>,
    setApiKey: (providerId: string, key: string, baseUrl?: string) =>
      ipcRenderer.invoke(IPC.providers.setApiKey, providerId, key, baseUrl) as Promise<boolean>,
    logout: (providerId: string) => ipcRenderer.invoke(IPC.providers.logout, providerId) as Promise<boolean>,
    loginApiKey: (providerId: string) =>
      ipcRenderer.invoke(IPC.providers.loginApiKey, providerId) as Promise<{ ok: boolean; error?: string }>,
    loginOAuth: (providerId: string) =>
      ipcRenderer.invoke(IPC.providers.loginOAuth, providerId) as Promise<{ ok: boolean; error?: string }>,
    respondLogin: (sessionId: string, response: LoginResponse) =>
      ipcRenderer.invoke(IPC.providers.respondLogin, sessionId, response) as Promise<boolean>,
    cancelLogin: (sessionId: string) =>
      ipcRenderer.invoke(IPC.providers.cancelLogin, sessionId) as Promise<boolean>,
    discoverModels: (baseUrl: string, apiKey: string, providerId: string) =>
      ipcRenderer.invoke(IPC.providers.discoverModels, baseUrl, apiKey, providerId) as Promise<ModelOption[]>,
    onLoginEvent: (cb: (payload: { sessionId: string; event: LoginEvent }) => void) =>
      subscribe(IPC.providers.loginEvent, cb),
    onChanged: (cb: (catalog: ProviderCatalog) => void) => subscribe(IPC.providers.changed, cb)
  },

  chat: {
    send: (input: { pageId: string; text: string; mode?: 'chat' | 'architect' }) =>
      ipcRenderer.invoke(IPC.chat.send, input) as Promise<ChatMessage>,
    abort: (pageId: string) => ipcRenderer.invoke(IPC.chat.abort, pageId) as Promise<boolean>,
    current: (pageId: string) => ipcRenderer.invoke(IPC.chat.current, pageId) as Promise<Conversation>,
    list: (pageId: string) => ipcRenderer.invoke(IPC.chat.list, pageId) as Promise<ConversationSummary[]>,
    create: (pageId: string) => ipcRenderer.invoke(IPC.chat.create, pageId) as Promise<Conversation>,
    select: (pageId: string, conversationId: string) =>
      ipcRenderer.invoke(IPC.chat.select, pageId, conversationId) as Promise<Conversation>,
    history: (pageId: string) => ipcRenderer.invoke(IPC.chat.history, pageId) as Promise<ChatMessage[]>,
    clear: (pageId: string) => ipcRenderer.invoke(IPC.chat.clear, pageId) as Promise<boolean>,
    onEvent: (cb: (event: ChatStreamEvent) => void) => subscribe(IPC.chat.event, cb)
  }
}

contextBridge.exposeInMainWorld('rasuko', api)

export type RasukoAPI = typeof api
export type { OpReceipt }
