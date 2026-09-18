// Explicit live-provider acceptance test. Uses the configured Rasuko account.
// Synthetic content and workspace only; never included in the default test suite.
import { build } from 'esbuild'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = process.cwd()
const sourceHome = process.env.RASUKO_HOME ?? join(homedir(), '.rasuko')
const temporary = mkdtempSync(join(tmpdir(), 'rasuko-kanban-live-'))
const testHome = join(temporary, 'home')
mkdirSync(testHome)
if (process.env.RASUKO_TEST_RESUME_HOME) {
  cpSync(join(process.env.RASUKO_TEST_RESUME_HOME, 'workspace'), join(testHome, 'workspace'), { recursive: true })
}
// Windows Chromium stores the encrypted credential master key in Local State.
// Copy just that encrypted metadata into the isolated Electron profile.
const sourceState = process.env.APPDATA && join(process.env.APPDATA, 'Rasuko', 'Local State')
if (sourceState && existsSync(sourceState)) {
  const { os_crypt } = JSON.parse(readFileSync(sourceState, 'utf8'))
  mkdirSync(join(testHome, 'electron'))
  writeFileSync(join(testHome, 'electron', 'Local State'), JSON.stringify({ os_crypt }))
}
for (const file of ['rasuko.conf', 'auth.json']) {
  if (existsSync(join(sourceHome, file))) copyFileSync(join(sourceHome, file), join(testHome, file))
}
const entry = join(temporary, 'main.mjs')
try {
  await build({
    entryPoints: ['scripts/kanban-live-test.ts'],
    bundle: true, platform: 'node', format: 'esm', outfile: entry,
    // Match electron-vite's ESM require shim used by the credential codec.
    banner: { js: "import { createRequire as createTestRequire } from 'node:module'; const require = createTestRequire(import.meta.url);" },
    tsconfig: 'tsconfig.node.json', packages: 'external',
    plugins: [{ name: 'installed-pi', setup(builder) {
      builder.onResolve({ filter: /^@earendil-works\/pi-ai(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }))
    } }]
  })
  const env = { ...process.env, RASUKO_HOME: testHome, RASUKO_TEST_ROOT: root }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = createRequire(import.meta.url)('electron')
  const child = spawn(electron, [entry], { env, windowsHide: true, stdio: 'inherit' })
  const timeout = setTimeout(() => { console.error('Live Kanban test exceeded 6 minutes'); child.kill() }, 360000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    process.exitCode = code ?? 1
  } finally {
    clearTimeout(timeout)
  }
} finally {
  // Remove only test credential copies, including a possible quarantine file.
  const { readdirSync } = await import('node:fs')
  for (const file of readdirSync(testHome)) {
    if (file === 'auth.json' || file.startsWith('auth.json.')) unlinkSync(join(testHome, file))
  }
  const copiedState = join(testHome, 'electron', 'Local State')
  if (existsSync(copiedState)) unlinkSync(copiedState)
}
