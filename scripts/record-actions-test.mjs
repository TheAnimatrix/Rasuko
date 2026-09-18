import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'rasuko-record-actions-'))
process.env.RASUKO_HOME = join(dir, 'home')
const output = join(dir, 'test.mjs')
await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'record-actions-test.ts', loader: 'ts', contents: String.raw`
import assert from 'node:assert/strict'
import {SettingsStore} from './src/main/settings/SettingsStore'
import {WorkspaceStore} from './src/main/workspace/WorkspaceStore'
import {RecordActionService} from './src/main/workspace/RecordActionService'
import {newId,nowIso} from './src/shared/ids'
import {queryTable,groupRows,aggregateRows} from './src/shared/tableQuery'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {projectDir,recordPath} from './src/main/paths'
const workspace = new WorkspaceStore(new SettingsStore())
const state=workspace.load(),page=workspace.pagePayload(state.activePageId!)!.page
const project=page.projectId,id=newId('record'),title=newId('block'),status=newId('block'),count=newId('block'),due=newId('block')
workspace.createRecord(project,{id,kind:'table',createdAt:nowIso(),updatedAt:nowIso(),columns:[
{id:title,name:'Title',type:'text'},{id:status,name:'Status',type:'select',options:['Todo','Doing','Done','Empty']},
{id:count,name:'Count',type:'number'},{id:due,name:'Due',type:'date'}],rows:[]},page.id)
let service=new RecordActionService(workspace)
const action=(a:any)=>service.execute(project,id,a)
const first=action({type:'row.create',cells:{[title]:'First',[status]:'Todo',[count]:4}}).affectedId!
const second=action({type:'row.create',cells:{[title]:'Second',[status]:'Doing',[count]:2}}).affectedId!
action({type:'row.update',rowId:first,cells:{[due]:'2026-10-12'}})
action({type:'row.update',rowId:first,cells:{[title]:'Edited'}})
let table=workspace.getRecord(project,id) as any
assert.equal(table.rows[0].cells[due],'2026-10-12','Patch preserves sibling fields')
assert.equal(table.rows[1].cells[title],'Second','Patch preserves other rows')
const revision=table.revision
assert.throws(()=>service.execute(project,id,{type:'row.update',rowId:first,cells:{[title]:'Stale'}},revision-1),/CONFLICT/)
assert.throws(()=>action({type:'row.update',rowId:first,cells:{[count]:'NaN'}}),/number/)
assert.throws(()=>action({type:'row.update',rowId:first,cells:{[due]:'2026-02-31'}}),/valid date/)
assert.throws(()=>action({type:'row.update',rowId:first,cells:{missing:7}}),/Unknown field/)
assert.equal(workspace.getRecord(project,id)!.revision,revision,'Rejected actions do not save')
action({type:'row.move',rowId:first,groupField:status,groupValue:'Doing',beforeRowId:second})
table=workspace.getRecord(project,id) as any
assert.deepEqual(table.rows.map((r:any)=>r.id),[first,second])
assert.equal(table.rows[0].cells[status],'Doing')
action({type:'column.options',columnId:status,options:['Todo','Active','Done','Empty'],rename:{from:'Doing',to:'Active'}})
assert.throws(()=>action({type:'column.options',columnId:status,options:['Todo','Done','Empty']}),/contains records/)
action({type:'column.options',columnId:status,options:['Todo','Done','Empty'],removedValue:'Active',reassignTo:'Todo'})
table=workspace.getRecord(project,id) as any
assert.ok(table.rows.every((r:any)=>r.cells[status]==='Todo'))
assert.deepEqual(groupRows(table,status).map(g=>[g.value,g.rows.length]),[['Todo',2],['Done',0],['Empty',0]])
assert.equal(aggregateRows(table,{},'sum',count),6)
assert.deepEqual(queryTable(table,{search:'edited'}).map(r=>r.id),[first])
assert.deepEqual(queryTable(table,{sort:[{field:count,direction:'asc'}]}).map(r=>r.id),[second,first])
assert.throws(()=>queryTable(table,{filters:[{field:count,op:'lt',value:'10'}]}),/number/,'Numeric filters cannot compare lexically')
assert.deepEqual(queryTable(table,{filters:[{field:count,op:'lt',value:3}]}).map(r=>r.id),[second])
const copy=action({type:'row.duplicate',rowId:first}).affectedId!
assert.notEqual(copy,first)
action({type:'row.archive',rowId:copy})
assert.equal(queryTable(workspace.getRecord(project,id) as any).length,2)
action({type:'row.delete',rowId:second})
service = new RecordActionService(new WorkspaceStore(new SettingsStore()))
let undo=service.undo(project,id)!
assert.ok((undo.record as any).rows.some((r:any)=>r.id===second),'Undo restores exact ID after restart')
undo=service.undo(project,id)!
assert.equal((undo.record as any).rows.find((r:any)=>r.id===copy).archived,false,'Successive undo works')
workspace.updateRecord(project,id,{label:'Later independent edit'})
assert.throws(()=>service.undo(project,id),/newer edits/,'Undo cannot overwrite newer work')
// Simulate a crash after saving content but before marking its journal committed.
action({type:'row.update',rowId:first,cells:{[title]:'Crash recovery'}})
const historyPath=join(projectDir(project),'.history',id+'.actions.json')
const journal=JSON.parse(readFileSync(historyPath,'utf8'))
journal.entries.at(-1).state='pending'
writeFileSync(historyPath,JSON.stringify(journal))
service = new RecordActionService(new WorkspaceStore(new SettingsStore()))
undo=service.undo(project,id)!
assert.equal((undo.record as any).rows.find((r:any)=>r.id===first).cells[title],'Edited')
// Files edited outside the app are also protected even if revision was not bumped.
action({type:'row.update',rowId:first,cells:{[title]:'Before external'}})
const current=workspace.getRecord(project,id) as any
current.rows[0].cells[title]='External'
writeFileSync(recordPath(project,id),JSON.stringify(current))
assert.throws(()=>service.undo(project,id),/newer edits/)
// Undo recovery normalizes legacy schema metadata without losing the audit state.
const legacyId=newId('record')
const legacy={id:legacyId,kind:'metric',value:1,createdAt:nowIso(),updatedAt:nowIso()}
writeFileSync(recordPath(project,legacyId),JSON.stringify(legacy))
service.execute(project,legacyId,{type:'metric.set',value:2})
const legacyHistoryPath=join(projectDir(project),'.history',legacyId+'.actions.json')
const legacyJournal=JSON.parse(readFileSync(legacyHistoryPath,'utf8'))
const undoing=legacyJournal.entries.at(-1)
undoing.state='undoing';undoing.undoRevision=2
writeFileSync(legacyHistoryPath,JSON.stringify(legacyJournal))
workspace.updateRecord(project,legacyId,{value:1},1)
assert.equal(new RecordActionService(workspace).undo(project,legacyId),null)
assert.equal(JSON.parse(readFileSync(legacyHistoryPath,'utf8')).entries.at(-1).state,'undone','Legacy schema normalization must not misclassify an undo')
const fieldsId=newId('record'),name=newId('block'),age=newId('block')
workspace.createRecord(project,{id:fieldsId,kind:'fields',createdAt:nowIso(),updatedAt:nowIso(),fields:[{id:name,name:'Name',type:'text',required:true},{id:age,name:'Age',type:'number'}],values:{}},page.id)
assert.throws(()=>service.execute(project,fieldsId,{type:'fields.submit',values:{}}),/required/)
service.execute(project,fieldsId,{type:'fields.update',values:{[name]:'Ada'}})
const submitted=service.execute(project,fieldsId,{type:'fields.submit',values:{[age]:36}}).record as any
assert.equal(submitted.entries[0].values[name],'Ada')
assert.equal(submitted.entries[0].values[age],36)
console.log('Record actions: patches, validation, revisions, ordering, lanes, queries, restart undo, crash recovery and external-edit conflicts passed')
` }, bundle: true, platform: 'node', format: 'esm', outfile: output, packages: 'external', alias: {'@shared':join(process.cwd(),'src/shared')} })
await import(pathToFileURL(output).href)
