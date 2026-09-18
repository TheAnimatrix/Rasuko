import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = process.cwd()
const testRoot = await mkdtemp(join(tmpdir(), 'rasuko-chat-history-'))
const bundlePath = join(testRoot, 'conversation-store.mjs')
const entryPath = join(testRoot, 'entry.ts')

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

try {
  await writeFile(
    entryPath,
    `export { ConversationStore } from ${JSON.stringify(join(root, 'src/main/ai/ConversationStore.ts').replaceAll('\\', '/'))}\n`,
    'utf8'
  )
  await build({
    absWorkingDir: root,
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    tsconfig: join(root, 'tsconfig.node.json'),
    logLevel: 'silent'
  })

  process.env.RASUKO_HOME = join(testRoot, 'home')
  const { ConversationStore } = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`)

  const projectId = 'prj_01J00000000000000000000000'
  const pageId = 'pg_01J00000000000000000000000'
  const legacyId = 'cht_01J00000000000000000000000'
  const projectRoot = join(process.env.RASUKO_HOME, 'workspace', 'projects', projectId)
  const legacyPath = join(projectRoot, 'chats', `${pageId}.chat.json`)
  const legacy = {
    id: legacyId,
    pageId,
    messages: [
      { id: 'msg_01J00000000000000000000000', role: 'user', text: 'Legacy planning notes', createdAt: '2026-01-01T00:00:00.000Z' }
    ],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  await json(legacyPath, legacy)
  const legacyBytes = await readFile(legacyPath, 'utf8')

  const workspace = { projectIdForPage: (candidate) => (candidate === pageId ? projectId : null) }
  const first = new ConversationStore(workspace)
  const migrated = first.getActive(pageId)
  assert.equal(migrated.id, legacyId)
  assert.equal(migrated.title, 'Legacy planning notes')
  assert.equal((await readFile(legacyPath, 'utf8')), legacyBytes, 'legacy source must not be overwritten')

  const fresh = first.create(pageId)
  fresh.messages.push({
    id: 'msg_01J00000000000000000000001',
    role: 'user',
    text: 'Second session survives restart',
    createdAt: '2026-01-02T00:00:00.000Z'
  })
  first.persist(fresh)
  assert.equal(first.list(pageId).length, 2)
  first.select(pageId, legacyId)

  const restarted = new ConversationStore(workspace)
  assert.equal(restarted.getActive(pageId).id, legacyId, 'selected session must resume after restart')
  assert.equal(restarted.select(pageId, fresh.id).messages[0]?.text, 'Second session survives restart')

  const indexPath = join(projectRoot, 'chats', pageId, 'index.json')
  await writeFile(indexPath, '{ malformed', 'utf8')
  const recovered = new ConversationStore(workspace)
  const recoveredList = recovered.list(pageId)
  assert.equal(recoveredList.length, 2, 'malformed index must recover every session file')
  assert.equal(recovered.getActive(pageId).id, fresh.id, 'recovery selects the most recently updated session')
  assert.equal((await readFile(legacyPath, 'utf8')), legacyBytes, 'recovery must leave legacy source untouched')

  assert.throws(() => recovered.getActive('pg_../../../../escape'), /Invalid page id/)
  assert.throws(() => recovered.select(pageId, 'cht_../../../../escape'), /Invalid conversation id/)

  console.log('chat-history-test: migration, create/list/select, restart, recovery, and path guards passed')
} finally {
  await rm(testRoot, { recursive: true, force: true })
}
