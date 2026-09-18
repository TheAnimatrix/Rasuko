import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, type ChatStreamEvent } from '@shared/ipc'
import type { Binding, ContentRecord, PageMeta, ViewDoc } from '@shared/types'
import type { ViewOp } from '@shared/viewOps'
import type { RecordAction } from '@shared/recordActions'
import { RecordActionService } from '../workspace/RecordActionService'
import { barebonesView } from '@shared/viewOps'
import type { RasukoSettingsUpdate } from '@shared/settings'
import type { WorkspaceStore } from '../workspace/WorkspaceStore'
import type { SettingsStore } from '../settings/SettingsStore'
import type { ProviderService } from '../providers/ProviderService'
import type { ChatService } from '../ai/ChatService'
import type { LoginEvent, LoginResponse } from '../providers/LoginSession'

export interface IpcDeps {
  workspace: WorkspaceStore
  settings: SettingsStore
  providers: ProviderService
  chat: ChatService
  getWindow: () => BrowserWindow | null
  applyThemeBackground: (hex: string) => void
}

function broadcast(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function registerIpc(deps: IpcDeps): void {
  const { workspace, settings, providers, chat, getWindow } = deps
  const recordActions = new RecordActionService(workspace)

  /* --------------------------------- app --------------------------------- */

  ipcMain.handle(IPC.app.info, () => ({
    name: 'Rasuko',
    version: app.getVersion(),
    platform: process.platform,
    encryptedCredentials: providers.isEncryptedAtRest(),
    home: process.env.RASUKO_HOME ?? '~/.rasuko'
  }))

  /* -------------------------------- window -------------------------------- */

  ipcMain.handle(IPC.window.minimize, () => getWindow()?.minimize())
  ipcMain.handle(IPC.window.maximize, () => {
    const window = getWindow()
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle(IPC.window.close, () => getWindow()?.close())
  ipcMain.handle(IPC.window.isMaximized, () => getWindow()?.isMaximized() ?? false)
  ipcMain.handle(IPC.window.setThemeBackground, (_event, hex: string) => {
    deps.applyThemeBackground(hex)
  })

  /* ------------------------------- workspace ------------------------------- */

  workspace.onChange((snapshot) => broadcast(IPC.workspace.changed, snapshot))

  ipcMain.handle(IPC.workspace.snapshot, () => workspace.snapshot())
  ipcMain.handle(IPC.workspace.createProject, (_e, name?: string) => workspace.createProject(name))
  ipcMain.handle(IPC.workspace.updateProject, (_e, id: string, patch: unknown) =>
    workspace.updateProject(id, patch as Parameters<WorkspaceStore['updateProject']>[1])
  )
  ipcMain.handle(IPC.workspace.deleteProject, (_e, id: string) => workspace.deleteProject(id))
  ipcMain.handle(IPC.workspace.createPage, (_e, projectId: string, init: { title?: string; markdown?: boolean; viewId?: string }) =>
    workspace.createPage(projectId, init)
  )
  ipcMain.handle(IPC.workspace.updatePage, (_e, pageId: string, patch: Partial<PageMeta>) =>
    workspace.updatePage(pageId, patch)
  )
  ipcMain.handle(IPC.workspace.deletePage, (_e, pageId: string, hard?: boolean) =>
    workspace.deletePage(pageId, hard)
  )
  ipcMain.handle(IPC.workspace.movePage, (_e, projectId: string, pageId: string, index: number) =>
    workspace.movePage(projectId, pageId, index)
  )
  ipcMain.handle(IPC.workspace.openPage, (_e, pageId: string) => workspace.openPage(pageId))
  ipcMain.handle(IPC.workspace.pagePayload, (_e, pageId: string) => workspace.pagePayload(pageId))

  /* -------------------------------- records -------------------------------- */

  ipcMain.handle(IPC.records.get, (_e, projectId: string, recordId: string) =>
    workspace.getRecord(projectId, recordId)
  )
  ipcMain.handle(IPC.records.list, (_e, projectId: string) => Object.values(workspace.allRecords(projectId)))
  ipcMain.handle(IPC.records.create, (_e, projectId: string, record: ContentRecord, pageId?: string) =>
    workspace.createRecord(projectId, record, pageId)
  )
  ipcMain.handle(IPC.records.update, (_e, projectId: string, recordId: string, patch: Partial<ContentRecord>, expectedRevision?: number) =>
    workspace.updateRecord(projectId, recordId, patch, expectedRevision)
  )
  ipcMain.handle(IPC.records.action, (_e, projectId: string, recordId: string, action: RecordAction, expectedRevision?: number) =>
    recordActions.execute(projectId, recordId, action, expectedRevision)
  )
  ipcMain.handle(IPC.records.undoAction, (_e, projectId: string, recordId: string) => recordActions.undo(projectId, recordId))
  ipcMain.handle(IPC.records.renameField, (_e, projectId: string, recordId: string, fieldId: string, name: string, expectedRevision?: number) => workspace.renameRecordField(projectId, recordId, fieldId, name, expectedRevision))
  ipcMain.handle(IPC.records.delete, (_e, projectId: string, recordId: string) => {
    workspace.deleteRecord(projectId, recordId)
    return true
  })
  ipcMain.handle(
    IPC.records.reattach,
    (_e, projectId: string, viewId: string, recordId: string, nodeId: string) =>
      workspace.reattach(projectId, viewId, recordId, nodeId)
  )

  /* --------------------------------- view --------------------------------- */

  ipcMain.handle(IPC.view.get, (_e, projectId: string, viewId: string) => workspace.getView(projectId, viewId))
  ipcMain.handle(IPC.view.list, (_e, projectId: string) => workspace.listViews(projectId))
  ipcMain.handle(IPC.view.save, (_e, projectId: string, view: ViewDoc, expectedRevision?: number) => workspace.saveView(projectId, view, expectedRevision))
  ipcMain.handle(IPC.view.applyOps, (_e, projectId: string, viewId: string, ops: ViewOp[], summary?: string, expectedRevision?: number) =>
    workspace.applyViewOps(projectId, viewId, ops, summary, expectedRevision)
  )
  ipcMain.handle(IPC.view.create, (_e, projectId: string, name?: string) =>
    workspace.saveView(projectId, barebonesView(name ?? 'Untitled View'))
  )
  ipcMain.handle(IPC.view.duplicate, (_e, projectId: string, viewId: string, name?: string) =>
    workspace.duplicateView(projectId, viewId, name)
  )
  ipcMain.handle(IPC.view.remove, (_e, projectId: string, viewId: string) => {
    workspace.removeView(projectId, viewId)
    return true
  })
  ipcMain.handle(IPC.view.export, (_e, projectId: string, viewId: string) => {
    const view = workspace.getView(projectId, viewId)
    if (!view) return null
    return JSON.stringify(
      { format: 'rasukoview', version: 1, view: { ...view, sourcePrompt: undefined } },
      null,
      2
    )
  })

  /* -------------------------------- settings ------------------------------- */

  ipcMain.handle(IPC.settings.get, () => settings.get())
  ipcMain.handle(IPC.settings.set, (_e, patch: RasukoSettingsUpdate) => {
    const next = settings.set(patch)
    deps.applyThemeBackground(next.appearance.accent)
    broadcast(IPC.settings.changed, next)
    return next
  })
  ipcMain.handle(IPC.settings.catalog, () => providers.catalog())

  /* -------------------------------- providers ------------------------------ */

  ipcMain.handle(IPC.providers.list, () => providers.catalog())
  ipcMain.handle(IPC.providers.setApiKey, async (_e, providerId: string, key: string, baseUrl?: string) => {
    await providers.setApiKey(providerId, key, baseUrl)
    return true
  })
  ipcMain.handle(IPC.providers.logout, async (_e, providerId: string) => {
    await providers.logout(providerId)
    return true
  })
  ipcMain.handle(IPC.providers.loginApiKey, (_e, providerId: string) => providers.loginApiKey(providerId))
  ipcMain.handle(IPC.providers.loginOAuth, (_e, providerId: string) => providers.loginOAuth(providerId))
  ipcMain.handle(IPC.providers.respondLogin, (_e, sessionId: string, response: LoginResponse) => {
    providers.respondLogin(sessionId, response)
    return true
  })
  ipcMain.handle(IPC.providers.cancelLogin, (_e, sessionId: string) => {
    providers.cancelLogin(sessionId)
    return true
  })
  ipcMain.handle(IPC.providers.discoverModels, (_e, baseUrl: string, apiKey: string, providerId: string) =>
    providers.discoverModels(providerId, baseUrl, apiKey)
  )

  // Wired by the ProviderService constructor through these callbacks.
  providers.onLoginEvent = (sessionId: string, event: LoginEvent) =>
    broadcast(IPC.providers.loginEvent, { sessionId, event })
  providers.onChanged = (catalog) => broadcast(IPC.providers.changed, catalog)

  /* ---------------------------------- chat --------------------------------- */

  ipcMain.handle(IPC.chat.send, (_e, input: { pageId: string; text: string; mode?: 'chat' | 'architect' }) =>
    chat.send(input)
  )
  ipcMain.handle(IPC.chat.abort, (_e, pageId: string) => chat.abort(pageId))
  ipcMain.handle(IPC.chat.history, (_e, pageId: string) => chat.history(pageId))
  ipcMain.handle(IPC.chat.current, (_e, pageId: string) => chat.current(pageId))
  ipcMain.handle(IPC.chat.list, (_e, pageId: string) => chat.list(pageId))
  ipcMain.handle(IPC.chat.create, (_e, pageId: string) => chat.create(pageId))
  ipcMain.handle(IPC.chat.select, (_e, pageId: string, conversationId: string) =>
    chat.select(pageId, conversationId)
  )
  ipcMain.handle(IPC.chat.clear, (_e, pageId: string) => {
    chat.clear(pageId)
    return true
  })
  chat.onEvent = (event: ChatStreamEvent) => broadcast(IPC.chat.event, event)

  /* ------------------------------ internal wire ---------------------------- */

  // The assistant may touch records while a turn is running; make sure the
  // renderer always re-reads the page payload.
  ipcMain.handle('internal:noop', () => true)
}

export function notifyMaximized(window: BrowserWindow): void {
  window.webContents.send(IPC.window.maximizedChanged, window.isMaximized())
}
