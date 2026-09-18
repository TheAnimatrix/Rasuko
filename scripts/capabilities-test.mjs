import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const testRoot = mkdtempSync(join(tmpdir(), 'rasuko-capabilities-'))
const output = join(testRoot, 'test.mjs')

await build({
  stdin: {
    sourcefile: 'capabilities-test.ts', loader: 'ts', resolveDir: process.cwd(),
    contents: String.raw`
import assert from 'node:assert/strict'
import { WorkspaceStore } from './src/main/workspace/WorkspaceStore'
import { SettingsStore } from './src/main/settings/SettingsStore'
import { localPlan } from './src/main/ai/ViewArchitect'
import { allTools, buildToolContext } from './src/main/ai/tools'
import { COMPONENT_MAP, registryCapabilities } from './src/shared/viewSchema'
import { inspectView, VIEW_RECIPES } from './src/shared/viewCapabilities'
import { applyViewOps } from './src/shared/viewOps'
import { validateContentRecord, validateViewDoc } from './src/shared/viewValidation'

const kanban = COMPONENT_MAP.kanban.capabilities!
assert.ok(kanban.interactions.some(item => item.id === 'change-group'))
assert.ok(kanban.interactions.some(item => item.id === 'create-lane'))
assert.equal(kanban.binding?.fieldRefs, 'id-or-name')
assert.equal(kanban.limits?.emptyGroups, 'select-options-only')
assert.equal(kanban.limits?.dragDrop, true)
assert.equal(COMPONENT_MAP.kanban.props.wipLimit.default, 0)
assert.equal(COMPONENT_MAP.kanban.props.showSearch.default, true)
assert.deepEqual(COMPONENT_MAP.button.bindable, ['table'])
assert.ok(COMPONENT_MAP.button.props.targetRecordId)
assert.equal(COMPONENT_MAP.calendar.capabilities?.support, 'display-only')
assert.equal(COMPONENT_MAP.timeline.capabilities?.interactions.length, 0)
assert.ok(registryCapabilities().find(item => item.type === 'table')?.capabilities)
assert.deepEqual(VIEW_RECIPES.map(recipe => recipe.id), ['tracker', 'crm', 'intake', 'dashboard'])
assert.ok(VIEW_RECIPES.every(recipe => !recipe.components.includes('calendar') && !recipe.components.includes('timeline')))

const workspace = new WorkspaceStore(new SettingsStore())
const initial = workspace.load()
const pageId = initial.activePageId!
let payload = workspace.pagePayload(pageId)!
const context = () => buildToolContext(workspace, pageId)
const tools = new Map(allTools().map(tool => [tool.name, tool]))
const architect = () => ({ page: payload.page, view: payload.view, records: payload.records, orphaned: payload.orphaned })

for (const request of ['make this a project tracker', 'build a CRM pipeline', 'turn this into a dashboard', 'make an intake form', 'add a checklist', 'back to notes', 'tidy this page']) {
  const plan = localPlan(request, architect())
  for (const record of plan.records) {
    const validation = validateContentRecord(record)
    assert.equal(validation.valid, true, request + ': invalid ' + record.kind + ': ' + validation.errors.join('; '))
  }
  const proposed = applyViewOps(payload.view, plan.ops)
  assert.equal(proposed.receipt.skipped.length, 0, request + ': skipped ops: ' + JSON.stringify(proposed.receipt.skipped))
  const records = { ...payload.records, ...Object.fromEntries(plan.records.map(record => [record.id, record])) }
  const validation = validateViewDoc(proposed.view, records)
  assert.equal(validation.valid, true, request + ': invalid final View: ' + validation.errors.join('; '))
}

const crm = localPlan('build a CRM pipeline', architect())
const crmTable = crm.records.find(record => record.kind === 'table')!
assert.equal(crmTable.kind, 'table')
if (crmTable.kind === 'table') {
  assert.deepEqual(crmTable.columns.find(column => column.name === 'Stage')?.options, ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'])
  const crmBoard = crm.ops.find(op => op.op === 'insert' && op.node.type === 'kanban')
  assert.ok(crmBoard && crmBoard.op === 'insert')
  if (crmBoard && crmBoard.op === 'insert') assert.equal(crmBoard.node.props?.groupBy, crmTable.columns.find(column => column.name === 'Stage')?.id)
}

const tracker = localPlan('make this a project tracker', architect())
const table = tracker.records.find(record => record.kind === 'table')!
assert.equal(table.kind, 'table')
if (table.kind === 'table') {
  const status = table.columns.find(column => column.name === 'Status')!
  const title = table.columns.find(column => column.name === 'Title')!
  assert.equal(status.type, 'select')
  assert.deepEqual(status.options, ['Backlog', 'Todo', 'In progress', 'Review', 'Done'])
  assert.equal(table.rows.length, 0, 'Starter recipe must not insert fake sample work')
  const board = tracker.ops.find(op => op.op === 'insert' && op.node.type === 'kanban')
  assert.ok(board && board.op === 'insert')
  if (board && board.op === 'insert') {
    assert.equal(board.node.props?.groupBy, status.id)
    assert.equal(board.node.props?.titleField, title.id)
  }
}

for (const record of tracker.records) workspace.createRecord(payload.page.projectId, record, pageId)
const applied = await tools.get('view_applyOps')!.execute({ ops: tracker.ops, summary: tracker.summary }, context())
const appliedBody = JSON.parse(applied.content)
assert.equal(appliedBody.inspection.valid, true)
payload = workspace.pagePayload(pageId)!

const described = JSON.parse((await tools.get('view_get')!.execute({}, context())).content)
const boardDiagnostic = described.diagnostics.nodes.find((node:any) => node.type === 'kanban')
assert.equal(boardDiagnostic.binding.status, 'resolved')
assert.ok(boardDiagnostic.supportedInteractions.includes('change-group'))
assert.ok(boardDiagnostic.supportedInteractions.includes('reorder-lane'))
assert.equal(boardDiagnostic.resolvedProps.groupBy.type, 'select')
assert.equal(described.diagnostics.valid, true)

const storedTable = workspace.getRecord(payload.page.projectId, table.id)!
assert.equal(storedTable.kind, 'table')
if (storedTable.kind === 'table') {
  const title = storedTable.columns.find(column => column.name === 'Title')!
  const status = storedTable.columns.find(column => column.name === 'Status')!
  const owner = storedTable.columns.find(column => column.name === 'Owner')!
  const columnIdsBefore = storedTable.columns.map(column => column.id)
  let revision = storedTable.revision ?? 0
  const first = await tools.get('record_action')!.execute({
    recordId: storedTable.id, expectedRevision: revision,
    action: { type: 'row.create', cells: { [title.id]: 'First', [status.id]: 'Backlog', [owner.id]: 'Ada' } }
  }, context())
  assert.equal(first.isError, undefined)
  const firstBody = JSON.parse(first.content); revision = firstBody.revision
  assert.equal(firstBody.inspection.valid, true)
  const second = await tools.get('record_action')!.execute({
    recordId: storedTable.id, expectedRevision: revision,
    action: { type: 'row.create', cells: { [title.id]: 'Second', [status.id]: 'Todo', [owner.id]: 'Bo' } }
  }, context())
  const secondBody = JSON.parse(second.content); revision = secondBody.revision
  const beforeEdit = workspace.getRecord(payload.page.projectId, storedTable.id)!
  assert.equal(beforeEdit.kind, 'table')
  const secondRowBefore = beforeEdit.kind === 'table' ? structuredClone(beforeEdit.rows.find(row => row.id === secondBody.affectedId)) : null
  const edited = await tools.get('record_action')!.execute({
    recordId: storedTable.id, expectedRevision: revision,
    action: { type: 'row.update', rowId: firstBody.affectedId, cells: { [owner.id]: 'Grace' } }
  }, context())
  revision = JSON.parse(edited.content).revision
  const moved = await tools.get('record_action')!.execute({
    recordId: storedTable.id, expectedRevision: revision,
    action: { type: 'row.move', rowId: firstBody.affectedId, groupField: status.id, groupValue: 'Done' }
  }, context())
  assert.equal(moved.isError, undefined)
  const after = workspace.getRecord(payload.page.projectId, storedTable.id)!
  assert.equal(after.kind, 'table')
  if (after.kind === 'table') {
    const firstRow = after.rows.find(row => row.id === firstBody.affectedId)!
    assert.equal(firstRow.cells[owner.id], 'Grace')
    assert.equal(firstRow.cells[title.id], 'First', 'Narrow update must preserve unrelated cells')
    assert.equal(firstRow.cells[status.id], 'Done')
    assert.deepEqual(after.rows.find(row => row.id === secondBody.affectedId), secondRowBefore, 'Other rows must remain unchanged')
    assert.deepEqual(after.columns.map(column => column.id), columnIdsBefore, 'Record actions must preserve schema IDs')
    assert.deepEqual(new Set(after.rows.map(row => row.id)), new Set([firstBody.affectedId, secondBody.affectedId]))
  }
}

const inspected = JSON.parse((await tools.get('view_inspect')!.execute({ includeCapabilities: true }, context())).content)
assert.equal(inspected.valid, true)
assert.ok(inspected.componentCapabilities.find((item:any) => item.type === 'kanban'))

const reused = localPlan('redesign this project tracker', architect())
assert.equal(reused.records.length, 0, 'A compatible bound table must be reused')
const originalStatus = table.kind === 'table' ? table.columns.find(column => column.name === 'Status')!.id : ''
const reusedBoard = reused.ops.find(op => op.op === 'insert' && op.node.type === 'kanban')
assert.ok(reusedBoard && reusedBoard.op === 'insert')
if (reusedBoard && reusedBoard.op === 'insert') assert.equal(reusedBoard.node.props?.groupBy, originalStatus, 'Redesign must preserve stable column IDs')

const badView = structuredClone(payload.view)
const badBoard = badView.root.children?.find(node => node.type === 'kanban')!
badBoard.props = { ...badBoard.props, groupBy: 'missing-column' }
const bad = inspectView(badView, payload.records)
assert.equal(bad.valid, false)
assert.ok(bad.issues.some(issue => issue.code === 'kanban-group-missing'))

console.log('PASS: machine-readable capabilities, reusable recipes, stable kanban IDs, resolved diagnostics and inspection')
`
  },
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  tsconfig: 'tsconfig.node.json', packages: 'external',
  plugins: [{ name: 'installed-pi', setup(builder) {
    builder.onResolve({ filter: /^@earendil-works\/pi-ai$/ }, () => ({ path: import.meta.resolve('@earendil-works/pi-ai'), external: true }))
  }}]
})

process.env.RASUKO_HOME = join(testRoot, 'home')
await import(pathToFileURL(output).href)
