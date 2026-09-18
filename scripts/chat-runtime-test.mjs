import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run against an isolated workspace and a deterministic in-process model.
const testRoot = mkdtempSync(join(tmpdir(), 'rasuko-chat-runtime-'))
const output = join(testRoot, 'test.mjs')
await build({
  stdin: {
    sourcefile: 'chat-runtime-test.ts', loader: 'ts', resolveDir: process.cwd(),
    contents: String.raw`
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChatService } from './src/main/ai/ChatService'
import { MAX_MODEL_TOOL_OUTPUT_CHARS } from './src/main/ai/chatHistory'
import { WorkspaceStore } from './src/main/workspace/WorkspaceStore'
import { SettingsStore } from './src/main/settings/SettingsStore'

const workspace = new WorkspaceStore(new SettingsStore())
const settings = new SettingsStore()
settings.set({ assistant: { model: { providerId: 'test', model: 'mock' } } })
const initial = workspace.load()
const pageId = initial.activePageId!
const payload = workspace.pagePayload(pageId)!
const recordId = payload.page.recordIds[0]
const model = { id: 'mock', name: 'Mock', provider: 'test', api: 'openai-completions', baseUrl: 'http://unused', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 4096, cost: {input:0,output:0,cacheRead:0,cacheWrite:0} }
const queue: any[] = []
const requests: any[] = []
const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
const final = (content: any[], stopReason = 'stop') => ({role:'assistant',content,api:model.api,provider:model.provider,model:model.id,usage,stopReason,timestamp:Date.now()})
const reply = (text: string) => final([{type:'text',text}])
const call = (id: string, name: string, args: any) => ({type:'toolCall',id,name,arguments:args})
const providers = {
  resolveModel: () => model,
  getModelsApi: () => ({streamSimple: (_model: any, context: any) => {
    requests.push(structuredClone(context))
    const message = queue.shift()
    assert.ok(message, 'Unexpected model request')
    return {
      async *[Symbol.asyncIterator]() {
        for(const block of message.content) if(block.type==='text') yield {type:'text_delta',delta:block.text}
        yield {type:'done',message}
      },
      result: async () => message
    }
  }})
} as any
let chat = new ChatService(workspace, providers, settings)
const events: any[] = []
chat.onEvent = event => events.push(event)
const original = chat.current(pageId)
queue.push(final([
  call('edit_view','view_applyOps',{ops:[{op:'setName',name:'Client intake'}]}),
  call('edit_record','record_update',{recordId,patch:{label:'Saved by the assistant'}})
], 'toolUse'), reply('I changed the View and its content label.'))
const first = await chat.send({pageId,text:'Change the page title and its content label.'})
assert.equal(first.error, undefined)
assert.equal(requests[0].messages.filter((m:any)=>m.role==='user' && m.content==='Change the page title and its content label.').length,1,'Current prompt must appear exactly once')
assert.ok(requests[0].tools.some((t:any)=>t.name==='write'), 'Ordinary chat must have edit tools')
assert.ok(requests[1].systemPrompt.includes('Client intake'), 'The next model round must see the new View')
assert.equal(first.toolCalls?.length,2)
assert.ok(events.length>0 && events.every(e=>e.pageId===pageId && e.conversationId===original.id),'Every event must carry page and conversation scope')
queue.push(reply('The View is now Client intake.'))
await chat.send({pageId,text:'What did you change?'})
const followup=requests.at(-1)
assert.ok(followup.messages.some((m:any)=>m.role==='toolResult' && m.toolName==='view_applyOps'),'Follow-up must remember View tool result')
assert.ok(followup.messages.some((m:any)=>m.role==='assistant' && m.content.some((b:any)=>b.type==='toolCall' && b.name==='record_update')),'Follow-up must remember record tool arguments')
assert.ok(followup.systemPrompt.includes('Client intake'))

const fresh=chat.create(pageId)
assert.notEqual(fresh.id,original.id)
queue.push(reply('This is a separate chat.'))
await chat.send({pageId,text:'Start fresh'})
assert.equal(requests.at(-1).messages.filter((m:any)=>m.role==='user').length,1,'New chat must not include prior conversation')
chat=new ChatService(workspace,providers,settings)
assert.equal(chat.list(pageId).length,2)
assert.equal(chat.select(pageId,original.id).messages.length,4,'Old conversation must resume after restart')
queue.push(reply('Resumed.'))
await chat.send({pageId,text:'Continue the earlier work'})
assert.ok(requests.at(-1).messages.some((m:any)=>m.role==='toolResult' && m.toolName==='view_applyOps'),'Persisted receipts survive restart')

const largePath=join(process.env.RASUKO_HOME!,'workspace','large.txt')
writeFileSync(largePath,'x'.repeat(100_000),'utf8')
const largeRequestStart=requests.length
queue.push(final([call('read_large','read',{path:'large.txt'})],'toolUse'),reply('I inspected the large file.'))
const largeTurn=await chat.send({pageId,text:'Read the large file.'})
assert.ok((largeTurn.toolCalls?.[0].output?.length??0)>90_000,'Persisted audit receipt keeps full tool output')
const currentRoundReceipt=requests[largeRequestStart+1].messages.find((m:any)=>m.role==='toolResult'&&m.toolName==='read')
assert.ok(currentRoundReceipt.content[0].text.length<=MAX_MODEL_TOOL_OUTPUT_CHARS,'Current-round model receipt is bounded')
assert.match(currentRoundReceipt.content[0].text,/tool output truncated/)

chat=new ChatService(workspace,providers,settings)
queue.push(reply('The file was large.'))
await chat.send({pageId,text:'What did that read show?'})
const rebuiltReceipt=requests.at(-1).messages.find((m:any)=>m.role==='toolResult'&&m.toolName==='read')
assert.ok(rebuiltReceipt.content[0].text.length<=MAX_MODEL_TOOL_OUTPUT_CHARS,'Restarted model history receipt is bounded')
assert.match(rebuiltReceipt.content[0].text,/tool output truncated/)

queue.push(final([
  call('first','record_update',{recordId,patch:{label:'First applied'}}),
  call('second','record_update',{recordId,patch:{label:'Should never apply'}})
],'toolUse'))
chat.onEvent=event=>{if(event.type==='tool_end' && event.id==='first')chat.abort(pageId)}
const stopped=await chat.send({pageId,text:'Apply two edits'})
assert.equal(stopped.toolCalls?.length,1,'Keep completed receipts on cancellation')
assert.equal(stopped.error,'Turn cancelled')
assert.equal(workspace.getRecord(payload.page.projectId,recordId)?.label,'First applied','Stop prevents queued mutation')
chat.onEvent=()=>{}
queue.push(reply('One reply.'))
const pending=chat.send({pageId,text:'Only one active turn'})
await assert.rejects(chat.send({pageId,text:'Overlapping turn'}),/current reply/)
await pending
console.log('PASS: fresh View context, bounded tool memory, one prompt, ordinary editing, scoped events, session resume, cancellation, concurrency')
`
  },
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  tsconfig: 'tsconfig.node.json', packages: 'external',
  plugins: [{ name: 'installed-pi', setup(builder) {
    builder.onResolve({ filter: /^@earendil-works\/pi-ai$/ }, () => ({ path: import.meta.resolve('@earendil-works/pi-ai'), external: true }))
  } }]
})
process.env.RASUKO_HOME = join(testRoot, 'home')
await import(pathToFileURL(output).href)
