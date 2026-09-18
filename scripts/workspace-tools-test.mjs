import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const testRoot = mkdtempSync(join(tmpdir(), 'rasuko-workspace-tools-'))
const output = join(testRoot, 'test.mjs')

await build({
  stdin: {
    sourcefile: 'workspace-tools-test.ts',
    loader: 'ts',
    resolveDir: process.cwd(),
    contents: String.raw`
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { WorkspaceStore } from './src/main/workspace/WorkspaceStore'
import { SettingsStore } from './src/main/settings/SettingsStore'
import { allTools, buildToolContext } from './src/main/ai/tools'
import { localPlan } from './src/main/ai/ViewArchitect'
import { barebonesView } from './src/shared/viewOps'

const workspace = new WorkspaceStore(new SettingsStore())
const initial = workspace.load()
const pageId = initial.activePageId!
let payload = workspace.pagePayload(pageId)!
const projectId = payload.page.projectId
const originalRecordId = payload.page.recordIds[0]
const tools = new Map(allTools().map(tool => [tool.name, tool]))
const context = () => buildToolContext(workspace, pageId)

const getResult = await tools.get('view_get')!.execute({}, context())
const described = JSON.parse(getResult.content)
assert.equal(described.page.path, workspace.workspaceRelativePagePath(projectId, pageId))
assert.equal(described.view.path, workspace.workspaceRelativeViewPath(projectId, payload.view.id))
assert.equal(described.records[0].path, workspace.workspaceRelativeRecordPath(projectId, originalRecordId))

const pageFile = join(process.env.RASUKO_HOME!, 'workspace', described.page.path)
const changedPage = { ...payload.page, title: 'Written through the file tool' }
let result = await tools.get('write')!.execute({ path: described.page.path, content: JSON.stringify(changedPage) }, context())
assert.equal(result.isError, undefined)
assert.equal(workspace.pagePayload(pageId)!.page.title, 'Written through the file tool')
const refreshedDescription = JSON.parse((await tools.get('view_get')!.execute({}, context())).content)
assert.equal(refreshedDescription.page.title, 'Written through the file tool')

const beforeInvalid = readFileSync(pageFile, 'utf8')
result = await tools.get('write')!.execute({ path: described.page.path, content: '{broken json' }, context())
assert.equal(result.isError, true)
assert.equal(readFileSync(pageFile, 'utf8'), beforeInvalid, 'Invalid managed JSON must not overwrite bytes')

payload = workspace.pagePayload(pageId)!
const viewWithoutBinding = structuredClone(payload.view)
viewWithoutBinding.kind = 'custom'
viewWithoutBinding.root.children = []
result = await tools.get('write')!.execute({ path: described.view.path, content: JSON.stringify(viewWithoutBinding) }, context())
assert.equal(result.isError, undefined)
assert.equal(workspace.getRecord(projectId, originalRecordId)?.orphaned, true, 'Removing a binding must orphan current-page content')

const newView = workspace.saveView(projectId, barebonesView('Replacement'))
const switchPage = { ...workspace.pagePayload(pageId)!.page, viewId: newView.id, recordIds: [] }
result = await tools.get('write')!.execute({ path: described.page.path, content: JSON.stringify(switchPage) }, context())
assert.equal(result.isError, undefined)
assert.ok(workspace.pagePayload(pageId)!.page.recordIds.includes(originalRecordId), 'Managed page View changes preserve prior record ownership')

const tableCreate = await tools.get('record_create')!.execute({
  kind: 'table', label: 'Tasks', data: {
    columns: [{ name: 'Name', type: 'text' }, { name: 'Score', type: 'number' }],
    rows: [{ cells: { Name: 'Alpha', Score: 7 } }]
  }
}, context())
const tableId = tableCreate.details!.recordId as string
const table = workspace.getRecord(projectId, tableId)!
assert.equal(table.kind, 'table')
if (table.kind === 'table') {
  assert.equal(table.rows[0].cells[table.columns[0].id], 'Alpha')
  assert.equal(table.rows[0].cells[table.columns[1].id], 7)
  assert.deepEqual((tableCreate.details!.columns as any[]).map(column => column.id), table.columns.map(column => column.id))
}
assert.ok(workspace.pagePayload(pageId)!.page.recordIds.includes(tableId), 'Created record is adopted before binding')

const fieldsCreate = await tools.get('record_create')!.execute({
  kind: 'fields', label: 'Intake', data: {
    fields: [{ name: 'Owner', type: 'text' }, { name: 'Priority', type: 'select', options: ['High'] }],
    values: { Owner: 'Ada', Priority: 'High' }
  }
}, context())
const fieldsId = fieldsCreate.details!.recordId as string
const fields = workspace.getRecord(projectId, fieldsId)!
assert.equal(fields.kind, 'fields')
if (fields.kind === 'fields') {
  assert.equal(fields.values[fields.fields[0].id], 'Ada')
  assert.equal(fields.values[fields.fields[1].id], 'High')
}

payload = workspace.pagePayload(pageId)!
const dashboard = localPlan('make this a dashboard', { page: payload.page, view: payload.view, records: payload.records, orphaned: payload.orphaned })
assert.ok(dashboard.ops.some(op => op.op === 'setName' && op.name === 'Dashboard'), 'Dashboard must not match the tracker board substring')
const trend = dashboard.records.find(record => record.kind === 'table')
assert.ok(trend && trend.kind === 'table')
if (trend && trend.kind === 'table') {
  assert.equal(trend.rows[0].cells[trend.columns[0].id], 'W1')
  assert.equal(trend.rows[0].cells[trend.columns[1].id], 12)
}

const second = workspace.createPage(projectId, { title: 'Unrelated page' })!
const secondRecordId = second.page.recordIds[0]
workspace.applyViewOps(projectId, workspace.pagePayload(pageId)!.view.id, [{ op: 'setName', name: 'Changed first page' }])
assert.notEqual(workspace.getRecord(projectId, secondRecordId)?.orphaned, true, 'Editing one View must not orphan another page record')

console.log('PASS: workspace paths, managed writes, adoption, scoped reconciliation, schema mapping, offline dashboard')
`
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
  tsconfig: 'tsconfig.node.json',
  packages: 'external',
  plugins: [{
    name: 'installed-pi',
    setup(builder) {
      builder.onResolve({ filter: /^@earendil-works\/pi-ai$/ }, () => ({
        path: import.meta.resolve('@earendil-works/pi-ai'),
        external: true
      }))
    }
  }]
})

process.env.RASUKO_HOME = join(testRoot, 'home')
await import(pathToFileURL(output).href)
