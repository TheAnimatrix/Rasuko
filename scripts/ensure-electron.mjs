// Self-healing Electron binary check, ported from the Mousse project.
// Ensures node_modules/electron/dist actually exists before dev/build runs.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const electronDir = join(root, 'node_modules', 'electron')

function installedBinary() {
  const pathTxt = join(electronDir, 'path.txt')
  if (!existsSync(pathTxt)) return null
  const name = readFileSync(pathTxt, 'utf-8').trim()
  if (!name) return null
  const binary = join(electronDir, 'dist', name)
  return existsSync(binary) ? binary : null
}

export function ensureElectron() {
  const existing = installedBinary()
  if (existing) return existing

  const installScript = join(electronDir, 'install.js')
  if (!existsSync(installScript)) {
    throw new Error(
      'Electron is not installed. Run `npm install` in the Rasuko project root first.'
    )
  }

  console.log('[rasuko] Electron binary missing — downloading...')
  const result = spawnSync(process.execPath, [installScript], {
    cwd: electronDir,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '' }
  })

  if (result.status !== 0) {
    throw new Error(
      `Electron download failed (exit ${result.status}). Set ELECTRON_MIRROR or retry.`
    )
  }
  const after = installedBinary()
  if (!after) throw new Error('Electron download finished but the binary is still missing.')
  return after
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ensureElectron()
}
