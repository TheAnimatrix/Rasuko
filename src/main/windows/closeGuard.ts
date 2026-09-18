import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'

/** Native close (including Alt+F4/quit) waits for renderer writes to finish. */
export function installCloseGuard(window: BrowserWindow): void {
  let allowed = false
  let pending: string | null = null
  const receive = (event: IpcMainEvent, token: string, saved: boolean): void => {
    if (window.isDestroyed() || event.sender !== window.webContents || !pending || pending !== token) return
    pending = null
    if (saved) { allowed = true; window.close() }
  }
  ipcMain.on(IPC.window.flushResult, receive)
  window.on('close', (event) => {
    if (allowed || window.webContents.isDestroyed() || window.webContents.isCrashed()) return
    event.preventDefault()
    if (pending) return
    pending = randomUUID()
    window.webContents.send(IPC.window.flushRequest, pending)
  })
  window.on('closed', () => ipcMain.removeListener(IPC.window.flushResult, receive))
}
