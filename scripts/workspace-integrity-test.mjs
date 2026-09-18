import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const testRoot = mkdtempSync(join(tmpdir(), 'rasuko-integrity-'))
const output = join(testRoot, 'test.mjs')

await build({
  stdin: {
    sourcefile: 'workspace-integrity-test.ts',
    loader: 'ts',
    resolveDir: process.cwd(),
    contents: String.raw`
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore, RevisionConflictError } from './src/main/workspace/WorkspaceStore'
import { commitFileTransaction, restoreFileCheckpoint } from './src/main/workspace/FileTransaction'
import { SettingsStore } from './src/main/settings/SettingsStore'
import { pagePath, workspaceIndexPath, workspaceRoot, viewPath, recordPath } from './src/main/paths'
import { barebonesView, makeNode } from './src/shared/viewOps'
import { newId, nowIso } from './src/shared/ids'

const store = new WorkspaceStore(new SettingsStore())
const initial = store.load()
const pageId = initial.activePageId!
const first = store.pagePayload(pageId)!
const projectId = first.page.projectId
const originalRecordId = first.page.recordIds[0]
assert.equal(first.records[originalRecordId].kind, 'richtext')
if (first.records[originalRecordId].kind === 'richtext') assert.equal(first.records[originalRecordId].doc.blocks[0].runs.length, 0, 'first launch starts blank')

// A structurally illegal move is skipped and does not touch the durable View.
const leaf = first.view.root.children![0]
const beforeMove = readFileSync(viewPath(projectId, first.view.id), 'utf8')
const moved = store.applyViewOps(projectId, first.view.id, [{ op: 'move', target: leaf.id, parent: leaf.id }])!
assert.equal(moved.receipt.applied, 0)
assert.match(moved.receipt.skipped[0].reason, /itself/)
assert.equal(readFileSync(viewPath(projectId, first.view.id), 'utf8'), beforeMove)

// Complete binding validation rejects missing records without changing bytes.
assert.throws(() => store.applyViewOps(projectId, first.view.id, [{ op: 'setBind', target: leaf.id, bind: { recordId: 'rec_00000000000000000000000000' } }]), /missing record/)
assert.equal(readFileSync(viewPath(projectId, first.view.id), 'utf8'), beforeMove)

// Typed patches preserve identity, reject malformed data and detect stale writes.
const record = store.getRecord(projectId, originalRecordId)!
const revision = record.revision ?? 0
assert.throws(() => store.updateRecord(projectId, record.id, { id: 'rec_00000000000000000000000000' } as any), /cannot change identity/)
const updated = store.updateRecord(projectId, record.id, { label: 'Revision one' }, revision)!
assert.equal(updated.revision, revision + 1)
assert.throws(() => store.updateRecord(projectId, record.id, { label: 'stale' }, revision), RevisionConflictError)
const recordBytes = readFileSync(recordPath(projectId, record.id), 'utf8')
const staleFileRecord = { ...updated, revision, label: 'stale file edit' }
const staleRecordWrite = store.writeManagedFile(store.workspaceRelativeRecordPath(projectId, record.id), JSON.stringify(staleFileRecord), pageId)!
assert.equal(staleRecordWrite.isError, true)
assert.equal(readFileSync(recordPath(projectId, record.id), 'utf8'), recordBytes)
const staleViewWrite = store.writeManagedFile(store.workspaceRelativeViewPath(projectId, first.view.id), JSON.stringify({ ...first.view, revision: 99 }), pageId)!
assert.equal(staleViewWrite.isError, true)
assert.equal(readFileSync(viewPath(projectId, first.view.id), 'utf8'), beforeMove)
const invalidRawView = structuredClone(first.view)
invalidRawView.root.children![0].props = { ...invalidRawView.root.children![0].props, unsupportedRawProperty: true }
const invalidRawWrite = store.writeManagedFile(store.workspaceRelativeViewPath(projectId, first.view.id), JSON.stringify(invalidRawView), pageId)!
assert.equal(invalidRawWrite.isError, true)
assert.match(invalidRawWrite.content, /unsupported property/)
assert.equal(readFileSync(viewPath(projectId, first.view.id), 'utf8'), beforeMove, 'raw validation runs before lossy prop coercion')
const missingTargetView = structuredClone(first.view)
missingTargetView.root.children!.push(makeNode('button', { props: { action: 'addRow', targetRecordId: 'rec_00000000000000000000000000' } }))
const missingTargetWrite = store.writeManagedFile(store.workspaceRelativeViewPath(projectId, first.view.id), JSON.stringify(missingTargetView), pageId)!
assert.equal(missingTargetWrite.isError, true)
assert.match(missingTargetWrite.content, /targetRecordId references missing record/)
assert.equal(readFileSync(viewPath(projectId, first.view.id), 'utf8'), beforeMove)

// A View plan validates every record before publishing any record, View, page or index file.
const planNow = nowIso()
const validMetricId = newId('record'), invalidMetricId = newId('record')
const beforePlanView = readFileSync(viewPath(projectId, first.view.id), 'utf8')
const beforePlanPage = readFileSync(pagePath(projectId, pageId), 'utf8')
const beforePlanIndex = readFileSync(workspaceIndexPath(), 'utf8')
assert.throws(() => store.applyViewPlan(projectId, first.view.id, [
  { id: validMetricId, kind: 'metric', value: 1, createdAt: planNow, updatedAt: planNow },
  { id: invalidMetricId, kind: 'metric', value: Number.NaN, createdAt: planNow, updatedAt: planNow }
], [
  { op: 'insert', parent: first.view.root.id, node: makeNode('metric', { bind: { recordId: validMetricId } }) },
  { op: 'insert', parent: first.view.root.id, node: makeNode('metric', { bind: { recordId: invalidMetricId } }) }
]), /metric value must be finite/)
assert.equal(existsSync(recordPath(projectId, validMetricId)), false)
assert.equal(existsSync(recordPath(projectId, invalidMetricId)), false)
assert.equal(readFileSync(viewPath(projectId, first.view.id), 'utf8'), beforePlanView)
assert.equal(readFileSync(pagePath(projectId, pageId), 'utf8'), beforePlanPage)
assert.equal(readFileSync(workspaceIndexPath(), 'utf8'), beforePlanIndex)

const metricA = newId('record'), metricB = newId('record')
const plan = store.applyViewPlan(projectId, first.view.id, [
  { id: metricA, kind: 'metric', value: 4, createdAt: planNow, updatedAt: planNow },
  { id: metricB, kind: 'metric', value: 8, createdAt: planNow, updatedAt: planNow }
], [
  { op: 'insert', parent: first.view.root.id, node: makeNode('metric', { bind: { recordId: metricA } }) },
  { op: 'insert', parent: first.view.root.id, node: makeNode('metric', { bind: { recordId: metricB } }) }
], 'Atomic metrics plan', first.view.revision ?? 0)!
assert.deepEqual(plan.receipt.createdRecords, [metricA, metricB])
assert.ok(store.pagePayload(pageId)!.page.recordIds.includes(metricA))
assert.ok(store.pagePayload(pageId)!.page.recordIds.includes(metricB))
assert.ok(existsSync(recordPath(projectId, metricA)) && existsSync(recordPath(projectId, metricB)))

// Surviving references protect shared records during hard deletion.
const sharedProjection = store.createPage(projectId, { title: 'Shared projection' })!
const sharedNode = sharedProjection.view.root.children![0]
store.applyViewOps(projectId, sharedProjection.view.id, [{ op: 'setBind', target: sharedNode.id, bind: { recordId: originalRecordId } }])
assert.throws(() => store.removeView(projectId, sharedProjection.view.id), /while a page uses it/)
assert.throws(() => store.deleteRecord(projectId, originalRecordId), /while View .* binds it/)
assert.equal(store.deletePage(pageId, true), true)
assert.ok(store.getRecord(projectId, originalRecordId), 'a surviving View binding protects the record')

// Standalone library Views protect records after their source page is deleted.
const libraryPage = store.createPage(projectId, { title: 'Library source' })!
const libraryRecordId = libraryPage.page.recordIds[0]
const libraryView = barebonesView('Reusable library View')
libraryView.root.children![0].bind = { recordId: libraryRecordId }
const savedLibraryView = store.saveView(projectId, libraryView)
assert.equal(store.deletePage(libraryPage.page.id, true), true)
assert.ok(store.getRecord(projectId, libraryRecordId), 'standalone library View keeps its bound record alive')
assert.throws(() => store.deleteRecord(projectId, libraryRecordId), /while View .* binds it/)
store.removeView(projectId, savedLibraryView.id)
assert.equal(existsSync(viewPath(projectId, savedLibraryView.id)), false)
store.deleteRecord(projectId, libraryRecordId)
assert.equal(existsSync(recordPath(projectId, libraryRecordId)), false)

// Unbound record removal cleans page ownership and the index in the same transaction.
const looseRecord = store.createRecord(projectId, { id: newId('record'), kind: 'metric', value: 3, createdAt: planNow, updatedAt: planNow }, sharedProjection.page.id)
assert.ok(store.snapshot().index.pages[sharedProjection.page.id].recordIds.includes(looseRecord.id))
store.deleteRecord(projectId, looseRecord.id)
assert.equal(existsSync(recordPath(projectId, looseRecord.id)), false)
assert.equal(store.snapshot().index.pages[sharedProjection.page.id].recordIds.includes(looseRecord.id), false)
const guardedLoose = store.createRecord(projectId, { id: newId('record'), kind: 'metric', value: 5, createdAt: planNow, updatedAt: planNow }, sharedProjection.page.id)
const unreadableViewId = newId('view'), unreadableViewPath = viewPath(projectId, unreadableViewId)
writeFileSync(unreadableViewPath, '{broken')
assert.throws(() => store.deleteRecord(projectId, guardedLoose.id), /unreadable or invalid/)
assert.ok(existsSync(recordPath(projectId, guardedLoose.id)), 'uncertain View scan cannot delete content')
rmSync(unreadableViewPath)
store.deleteRecord(projectId, guardedLoose.id)

// Field-id bindings and projection props are remapped with table templates.
const now = nowIso()
const statusId = newId('block')
const titleId = newId('block')
const table = store.createRecord(projectId, {
  id: newId('record'), kind: 'table', label: 'Tasks',
  columns: [{ id: titleId, name: 'Title', type: 'text' }, { id: statusId, name: 'Status', type: 'select', options: ['Open'] }],
  rows: [{ id: newId('block'), cells: { [titleId]: 'One', [statusId]: 'Open' }, archived: true }],
  createdAt: now, updatedAt: now
} as any)
const board = barebonesView('Board')
board.root.children = [
  makeNode('kanban', { props: { groupBy: 'Status', titleField: 'Title' }, bind: { recordId: table.id, field: 'Status' } }),
  makeNode('table', { props: { columns: ['Title', 'Status'] }, bind: { recordId: table.id } })
]
const savedBoard = store.saveView(projectId, board)
const savedBoardBytes = readFileSync(viewPath(projectId, savedBoard.id), 'utf8')
const missingGroupBoard = structuredClone(savedBoard)
missingGroupBoard.root.children![0].props!.groupBy = 'missing-group-field'
const missingGroupWrite = store.writeManagedFile(store.workspaceRelativeViewPath(projectId, savedBoard.id), JSON.stringify(missingGroupBoard), pageId)!
assert.equal(missingGroupWrite.isError, true)
assert.match(missingGroupWrite.content, /groupBy references missing column/)
assert.equal(readFileSync(viewPath(projectId, savedBoard.id), 'utf8'), savedBoardBytes)
const renamed = store.renameRecordField(projectId, table.id, statusId, 'Lane', table.revision ?? 0)!
assert.equal(renamed.kind, 'table')
if (renamed.kind === 'table') {
  assert.equal(renamed.columns.find(column => column.id === statusId)!.name, 'Lane')
  assert.deepEqual(renamed.columns.map(column => column.id), [titleId, statusId], 'schema IDs survive rename')
}
const migratedBoard = store.getView(projectId, savedBoard.id)!
assert.equal(migratedBoard.root.children![0].props!.groupBy, statusId)
assert.equal(migratedBoard.root.children![0].props!.titleField, titleId)
assert.equal(migratedBoard.root.children![0].bind!.field, statusId)
assert.deepEqual(migratedBoard.root.children![1].props!.columns, [titleId, statusId])

// Template instantiation creates an independent graph across projects.
const destination = store.createProject('Destination')
const cloned = store.createPage(destination.id, { title: 'Clone', viewId: savedBoard.id })!
assert.notEqual(cloned.view.id, savedBoard.id)
assert.notEqual(cloned.view.root.id, savedBoard.root.id)
assert.equal(cloned.page.recordIds.length, 1)
assert.ok(!cloned.page.recordIds.includes(table.id))
const clonedRecord = cloned.records[cloned.page.recordIds[0]]
assert.ok(clonedRecord)
assert.equal(clonedRecord.kind, 'table')
if (clonedRecord.kind === 'table') {
  assert.notDeepEqual(clonedRecord.columns.map(column => column.id), [titleId, statusId])
  assert.equal((clonedRecord.rows[0] as any).archived, true)
  assert.equal(cloned.view.root.children![0].props!.groupBy, clonedRecord.columns[1].id)
  assert.equal(cloned.view.root.children![0].bind!.field, clonedRecord.columns[1].id)
  assert.deepEqual(cloned.view.root.children![1].props!.columns, clonedRecord.columns.map(column => column.id))
}

// Deleting either page cannot remove the independent instance.
assert.ok(store.getRecord(destination.id, clonedRecord.id))
assert.ok(readFileSync(recordPath(destination.id, clonedRecord.id), 'utf8'))

// Generic file batches retain a restorable before-image checkpoint.
const txFile = recordPath(destination.id, clonedRecord.id)
const beforeTx = readFileSync(txFile, 'utf8')
const checkpoint = commitFileTransaction(workspaceRoot(), 'test checkpoint', [{ path: txFile, contents: '{}\n' }])
assert.equal(readFileSync(txFile, 'utf8'), '{}\n')
restoreFileCheckpoint(workspaceRoot(), checkpoint.id)
assert.equal(readFileSync(txFile, 'utf8'), beforeTx)

// A failed publication rolls back earlier writes, leaving no half-applied state.
const rollbackFile = join(workspaceRoot(), 'rollback.txt')
const blockingParent = join(workspaceRoot(), 'not-a-directory')
writeFileSync(rollbackFile, 'before')
writeFileSync(blockingParent, 'file')
assert.throws(() => commitFileTransaction(workspaceRoot(), 'forced failure', [
  { path: rollbackFile, contents: 'after' },
  { path: join(blockingParent, 'child.txt'), contents: 'cannot write' }
]))
assert.equal(readFileSync(rollbackFile, 'utf8'), 'before')

// Restart recovery restores a prepared transaction containing an applied after-image.
const recoveryFile = join(workspaceRoot(), 'recovery.txt')
const interrupted = commitFileTransaction(workspaceRoot(), 'simulated interruption', [{ path: recoveryFile, contents: 'partial' }])
const interruptedManifest = join(workspaceRoot(), '.checkpoints', interrupted.id, 'manifest.json')
writeFileSync(interruptedManifest, JSON.stringify({ ...interrupted, committed: false }, null, 2) + '\n')
const restarted = new WorkspaceStore(new SettingsStore())
restarted.load()
assert.equal(existsSync(recoveryFile), false, 'startup removes the half-created after-image')

// A committed checkpoint refuses to overwrite bytes changed later.
const conflictFile = join(workspaceRoot(), 'conflict.txt')
writeFileSync(conflictFile, 'v1')
const committed = commitFileTransaction(workspaceRoot(), 'conflict guard', [{ path: conflictFile, contents: 'v2' }])
writeFileSync(conflictFile, 'v3')
assert.throws(() => restoreFileCheckpoint(workspaceRoot(), committed.id), /changed after the checkpoint/)
assert.equal(readFileSync(conflictFile, 'utf8'), 'v3')

console.log('workspace-integrity-test: passed')
`
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: 'inline',
  tsconfig: join(process.cwd(), 'tsconfig.node.json')
})

process.env.RASUKO_HOME = testRoot
await import(pathToFileURL(output).href)
