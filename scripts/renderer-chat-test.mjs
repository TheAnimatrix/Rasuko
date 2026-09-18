import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, transform } from 'esbuild'
import { compileModule } from 'svelte/compiler'

const root = process.cwd()
const testRoot = await mkdtemp(join(tmpdir(), 'rasuko-renderer-chat-'))
const compiledPath = join(testRoot, 'chat.compiled.js')
const mockWorkspacePath = join(testRoot, 'workspace.js')
const bundlePath = join(testRoot, 'chat-test-bundle.mjs')

try {
  const source = await readFile(join(root, 'src/renderer/lib/stores/chat.svelte.ts'), 'utf8')
  const stripped = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })
  const compiled = compileModule(stripped.code, {
    filename: 'chat.svelte.ts',
    generate: 'client',
    dev: false
  })
  await writeFile(compiledPath, compiled.js.code, 'utf8')
  await writeFile(
    mockWorkspacePath,
    `export const workspace = { activePageId: null, refreshPayload: async () => undefined }\n`,
    'utf8'
  )

  await build({
    absWorkingDir: root,
    entryPoints: [compiledPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    nodePaths: [join(root, 'node_modules')],
    logLevel: 'silent',
    plugins: [{
      name: 'renderer-chat-mocks',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\$lib\/stores\/workspace\.svelte$/ }, () => ({ path: mockWorkspacePath }))
        buildApi.onResolve({ filter: /^@shared\/ids$/ }, () => ({ path: join(root, 'src/shared/ids.ts') }))
      }
    }]
  })

  const browser = new EventTarget()
  let onChatEvent = () => undefined
  let sendCalls = 0
  const conversations = new Map([
    ['page-a', { id: 'conversation-a', pageId: 'page-a', messages: [], updatedAt: new Date().toISOString() }],
    ['page-b', { id: 'conversation-b', pageId: 'page-b', messages: [], updatedAt: new Date().toISOString() }],
    ['page-fail', { id: 'conversation-fail', pageId: 'page-fail', messages: [], updatedAt: new Date().toISOString() }]
  ])
  browser.rasuko = {
    chat: {
      onEvent(listener) { onChatEvent = listener; return () => undefined },
      current: async (pageId) => structuredClone(conversations.get(pageId)),
      list: async (pageId) => [{ id: conversations.get(pageId).id, pageId, title: 'Test', updatedAt: new Date().toISOString() }],
      send: async () => { sendCalls += 1; throw new Error('chat IPC should not run after a failed editor flush') },
      abort: async () => undefined,
      create: async (pageId) => structuredClone(conversations.get(pageId)),
      select: async (pageId) => structuredClone(conversations.get(pageId))
    }
  }
  globalThis.window = browser
  if (!globalThis.CustomEvent) {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init = {}) { super(type); this.detail = init.detail }
    }
  }

  const { chat } = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`)
  await chat.attach('page-a')
  onChatEvent({ type: 'turn_start', pageId: 'page-a', conversationId: 'conversation-a', turnId: 'turn-a' })
  onChatEvent({ type: 'text_delta', pageId: 'page-a', conversationId: 'conversation-a', turnId: 'turn-a', delta: 'still working' })
  await chat.attach('page-b')
  await chat.attach('page-a')
  assert.equal(chat.pending?.text, 'still working', 'reattaching must restore the page pending turn')

  await chat.attach('page-fail')
  browser.addEventListener('rasuko:flush-editors', (event) => {
    event.detail.waitUntil(Promise.reject(new Error('editor flush failed')))
  }, { once: true })
  await chat.send('do not persist this optimistic prompt')
  assert.equal(sendCalls, 0, 'chat IPC must wait for and stop on failed editor writes')
  assert.deepEqual(chat.messages, [], 'a failed flush must not leave an optimistic prompt')
  assert.equal(chat.error, 'editor flush failed')
  assert.equal(chat.loading, false)

  console.log('renderer-chat-test: pending restoration and failed-flush rollback passed')
} finally {
  await rm(testRoot, { recursive: true, force: true })
}
