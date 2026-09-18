import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { SettingsStore } from './settings/SettingsStore'
import { WorkspaceStore } from './workspace/WorkspaceStore'
import { createProviderService } from './providers/ProviderService'
import { ChatService } from './ai/ChatService'
import { registerIpc, notifyMaximized } from './ipc/registerIpc'
import { IPC } from '@shared/ipc'
import { installCloseGuard } from './windows/closeGuard'

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  return {
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    b: Number.parseInt(full.slice(4, 6), 16) || 0
  }
}

/** Slightly warm near-black the window paints before the renderer is ready. */
function windowBackground(accent: string, theme: 'light' | 'dark'): string {
  if (theme === 'light') return '#fafafa'
  const { r, g, b } = hexToRgb(accent)
  const mix = (channel: number) => Math.round(channel * 0.12 + 12 * 0.88)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

function resolveTheme(theme: string): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function createWindow(settings: SettingsStore): BrowserWindow {
  const appearance = settings.get().appearance
  const resolved = resolveTheme(appearance.theme)

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'Rasuko',
    backgroundColor: windowBackground(appearance.accent, resolved),
    fullscreenable: false,
    autoHideMenuBar: true,
    ...(isWindows
      ? { titleBarStyle: 'hidden' as const, thickFrame: true }
      : isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })

  window.once('ready-to-show', () => window.show())
  installCloseGuard(window)

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const windowEvents = ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const
  for (const event of windowEvents) {
    window.on(event as 'maximize', () => notifyMaximized(window))
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function bootstrap(): void {
  const settings = new SettingsStore()
  const workspace = new WorkspaceStore(settings)
  workspace.load()

  const providers = createProviderService()
  const chat = new ChatService(workspace, providers, settings)

  registerIpc({
    workspace,
    settings,
    providers,
    chat,
    getWindow: () => mainWindow,
    applyThemeBackground: () => {
      /* window background follows the theme at creation; kept for future use */
    }
  })

  mainWindow = createWindow(settings)

  void providers.init()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(settings)
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('before-quit', () => {
    providers.stop()
  })

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC.settings.changed, settings.get())
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(bootstrap)
}
