import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = process.cwd()
const temporary = mkdtempSync(join(tmpdir(), 'rasuko-ui-smoke-'))
const entry = join(temporary, 'main.mjs')
await build({
  stdin: { resolveDir: root, sourcefile: 'ui-smoke.ts', loader: 'ts', contents: String.raw`
import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {writeFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
import {SettingsStore} from './src/main/settings/SettingsStore'
import {WorkspaceStore} from './src/main/workspace/WorkspaceStore'
import {ChatService} from './src/main/ai/ChatService'
import {registerIpc} from './src/main/ipc/registerIpc'
import {newId} from './src/shared/ids'
app.setPath('userData',join(process.env.RASUKO_HOME!,'electron'))
void app.whenReady().then(async () => {
const settings=new SettingsStore()
const workspace=new WorkspaceStore(settings)
const state=workspace.load()
const pageId=state.activePageId!
const initial=workspace.pagePayload(pageId)!
const projectId=initial.page.projectId
const recordId=initial.page.recordIds[0]
const blockId=newId('block')
workspace.updateRecord(projectId,recordId,{doc:{type:'doc',blocks:[
  {id:blockId,type:'heading',level:2,runs:[{text:'Formatted note',marks:['bold']}]},
  {id:newId('block'),type:'paragraph',runs:[{text:'Keep this supporting paragraph.'}]}
]}})
const second=workspace.createPage(projectId,{title:'Second page'})!
workspace.openPage(pageId)
const providers={catalog:()=>({providers:[]}),isEncryptedAtRest:()=>false} as any
const chat=new ChatService(workspace,providers,settings)
const window=new BrowserWindow({show:false,width:1320,height:860,webPreferences:{
  preload:join(process.env.RASUKO_TEST_ROOT!,'out/preload/index.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,offscreen:true
}})
registerIpc({workspace,settings,providers,chat,getWindow:()=>window,applyThemeBackground:()=>{}})
const errors:string[]=[]
window.webContents.on('render-process-gone',(_event,details)=>errors.push(JSON.stringify(details)))
window.webContents.on('console-message',(details)=>{
  if(details.message.startsWith('Uncaught')) errors.push(details.message)
})
const evaluate=(source:string)=>window.webContents.executeJavaScript(source,true)
async function until(source:string,label:string){
  for(let attempt=0;attempt<100;attempt++){
    if(await evaluate(source))return
    await delay(100)
  }
  throw new Error('Timed out: '+label+'\n'+await evaluate('document.body.innerText.slice(0,3000)'))
}
async function clickText(label:string,scope='document'){
  const clicked=await evaluate('(()=>{const b=[...'+scope+'.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(label)+');if(!b)return false;b.click();return true})()')
  assert.ok(clicked,'Button missing: '+label)
}
async function send(text:string){
  await until('!!document.querySelector("textarea[placeholder=\\"Ask anything…\\"]")','assistant composer')
  await evaluate('(()=>{const e=document.querySelector("textarea[placeholder=\\"Ask anything…\\"]");e.value='+JSON.stringify(text)+';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));})()')
}
try{
  await window.loadFile(join(process.env.RASUKO_TEST_ROOT!,'out/renderer/index.html'))
  await until('document.querySelector("[contenteditable=true]")?.textContent.includes("Formatted note")','rendered structured editor with Markdown off')
  assert.equal(await evaluate('!!document.querySelector("textarea[aria-label=\\"Plain text\\"]")'),false)
  assert.ok(await evaluate('!!document.querySelector("main [contenteditable] .font-semibold")'),'Formatting must render without Markdown syntax enabled')
  await evaluate('(()=>{const e=document.querySelector("[contenteditable=true]");e.focus();e.textContent="Updated heading";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"Updated heading"}));e.blur()})()')
  await until('window.rasuko.records.get('+JSON.stringify(projectId)+','+JSON.stringify(recordId)+').then(r=>r.doc.blocks[0].runs.some(x=>x.text.includes("Updated heading")))','direct editor save')
  await clickText('Second page')
  await until('location.hash.includes('+JSON.stringify(second.page.id)+') && !!document.querySelector("[contenteditable=true]")','navigate to second page')
  await clickText('Notes')
  await until('location.hash.includes('+JSON.stringify(pageId)+') && document.querySelector("[contenteditable=true]")?.textContent.includes("Updated heading")','return to saved page')
  await evaluate('document.querySelector("button[aria-label=\\"Show assistant\\"]")?.click()')
  await until('!!document.querySelector("button[aria-label=\\"Chat history\\"]:not(:disabled)")','chat ready')
  await send('Make this a form')
  await until('!!document.querySelector("main form input")','custom form generated')
  assert.equal(workspace.pagePayload(pageId)?.view.kind,'custom')
  await evaluate('(()=>{const input=document.querySelector("main form input");input.value="Customer request";input.dispatchEvent(new Event("input",{bubbles:true}));})()')
  await until('document.querySelector("main").innerText.includes("Draft saved locally")','form draft saved separately')
  await clickText('Second page')
  await until('location.hash.includes('+JSON.stringify(second.page.id)+')','leave unsubmitted form')
  await clickText('Notes')
  await until('document.querySelector("main form input")?.value==="Customer request"','unsubmitted form draft restored')
  await until('!!document.querySelector("main form button[type=submit]:not(:disabled)")','form is ready to submit')
  await evaluate('document.querySelector("main form").requestSubmit()')
  await until('document.querySelector("main").innerText.includes("Customer request")','form submission shown')
  const fields=Object.values(workspace.pagePayload(pageId)!.records).find(r=>r.kind==='fields') as any
  assert.equal(fields.entries.length,1,'Form entry persisted')
  const firstConversation=chat.current(pageId).id
  await until('!!document.querySelector("button[aria-label=\\"Chat history\\"]:not(:disabled)")','history available after reply')
  await evaluate('document.querySelector("button[aria-label=\\"Chat history\\"]").click()')
  await until('document.body.innerText.includes("New chat")','history menu')
  await clickText('New chat')
  await until('document.body.innerText.includes("Suggestions")','new conversation')
  assert.notEqual(chat.current(pageId).id,firstConversation)
  await send('Hello from a new conversation')
  await until('document.body.innerText.includes("No model is configured")','new chat reply')
  await evaluate('document.querySelector("button[aria-label=\\"Chat history\\"]").click()')
  await until('document.body.innerText.includes("Make this a form")','previous chat listed')
  await evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Make this a form")&&!b.disabled);if(!b)throw new Error("No previous chat button");b.click()})()')
  await until('document.body.innerText.includes("purpose-built form record")','previous conversation reopened')
  assert.equal(chat.current(pageId).id,firstConversation)
  assert.ok(!await evaluate('document.querySelector("main").innerText.includes("**")'),'No exposed source Markdown in custom view')
  assert.ok(!await evaluate('document.querySelector("main").innerText.includes("Keep this supporting paragraph.")'),'Preserved notes start collapsed')
  await evaluate('document.querySelector("button[aria-label=\\"Start editing New entry\\"]").click()')
  await until('!!document.querySelector("main [contenteditable=true]")','direct custom heading editor')
  await evaluate('(()=>{const e=document.querySelector("main [contenteditable=true]");e.focus();e.textContent="Client intake";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"Client intake"}));e.blur()})()')
  await until('window.rasuko.workspace.pagePayload('+JSON.stringify(pageId)+').then(p=>Object.values(p.records).some(r=>r.kind==="richtext"&&r.doc.blocks.some(b=>b.runs?.some(x=>x.text.includes("Client intake")))))','custom heading saved by binding')
  writeFileSync(join(process.env.RASUKO_TEST_ROOT!,'artifacts/custom-view-smoke.png'),(await window.webContents.capturePage()).toPNG())

  await send('Make this a project tracker')
  await until('!!document.querySelector("main table")','empty tracker table rendered')
  await clickText('+ Add task','document.querySelector("main")')
  await until('!!document.querySelector("[role=dialog] input[aria-label=Title]")','complete card creation')
  await evaluate('(()=>{const e=document.querySelector("[role=dialog] input[aria-label=Title]");e.value="Created through shared inputs";e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new FocusEvent("blur",{bubbles:true}));})()')
  await clickText('Create','document.querySelector("[role=dialog]")')
  await until('!!document.querySelector("main table input")','created card shares table data')
  await evaluate('(()=>{const e=document.querySelector("main table input");e.value="Saved across navigation";e.dispatchEvent(new Event("input",{bubbles:true}));})()')
  await clickText('Second page')
  await until('location.hash.includes('+JSON.stringify(second.page.id)+')','leave before table debounce')
  await clickText('Notes')
  await until('[...document.querySelectorAll("main table input")].some(i=>i.value==="Saved across navigation")','table edit survives navigation')
  await until('document.querySelector("main article input[aria-label=Title]")?.value==="Saved across navigation"','board reflects table edit')
  await clickText('+ Add task','document.querySelector("main")')
  await until('!!document.querySelector("[role=dialog] input[aria-label=Title]")','second card creation')
  await evaluate('(()=>{const e=document.querySelector("[role=dialog] input[aria-label=Title]");e.value="Second shared card";e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new FocusEvent("blur",{bubbles:true}));})()')
  await clickText('Create','document.querySelector("[role=dialog]")')
  await until('document.querySelectorAll("main table tbody tr").length===2','board task also appears in table')
  await until('!!document.querySelector("button[aria-label=\\"Chat history\\"]:not(:disabled)")','tracker chat attached')
  await send('Make this a dashboard')
  await until('!!document.querySelector("main input[aria-label=\\"Revenue\\"]")','dashboard generated')
  assert.equal(workspace.pagePayload(pageId)?.view.name,'Dashboard')
  await evaluate('(()=>{const e=document.querySelector("main input[aria-label=\\"Revenue\\"]");e.value="1250";e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new FocusEvent("blur",{bubbles:true}));})()')
  await until('window.rasuko.workspace.pagePayload('+JSON.stringify(pageId)+').then(p=>Object.values(p.records).some(r=>r.kind==="metric"&&r.label==="Revenue"&&r.value===1250))','metric input persisted')
  assert.ok(workspace.getRecord(projectId,recordId)?.kind==='richtext','Original prose survives repeated redesigns')
  assert.notEqual(workspace.getRecord(projectId,recordId)?.orphaned,true,'Original prose remains bound in preserved Notes')
  assert.deepEqual(errors,[])
  console.log('PASS: Electron rich editing, navigation, form and heading save, chat history resume, tracker/table/board synchronization, dashboard metric input')
  app.exit(0)
}catch(error){
  console.error(error)
  console.error('Renderer errors:',errors)
  console.error('Table rows:',JSON.stringify(Object.values(workspace.pagePayload(pageId)!.records).filter(r=>r.kind==='table')))
  console.error('Main View:',JSON.stringify(workspace.pagePayload(pageId)?.view))
  console.error('Renderer fetched View:',await evaluate('window.rasuko.workspace.pagePayload('+JSON.stringify(pageId)+').then(p=>JSON.stringify(p.view))'))
  try { writeFileSync(join(process.env.RASUKO_TEST_ROOT!,'artifacts/ui-smoke-failure.png'),(await window.webContents.capturePage()).toPNG()) } catch {}
  app.exit(1)
}
}).catch(error=>{console.error(error);app.exit(1)})
` },
  bundle: true, platform: 'node', format: 'esm', outfile: entry,
  tsconfig: 'tsconfig.node.json', packages: 'external',
  plugins: [{ name: 'installed-pi', setup(builder) {
    builder.onResolve({ filter: /^@earendil-works\/pi-ai$/ }, () => ({ path: import.meta.resolve('@earendil-works/pi-ai'), external: true }))
  } }]
})
const env = { ...process.env, RASUKO_HOME: join(temporary, 'home'), RASUKO_TEST_ROOT: root }
delete env.ELECTRON_RUN_AS_NODE
const electron = createRequire(import.meta.url)('electron')
const child = spawn(electron, [entry], { env, windowsHide: true, stdio: 'inherit' })
const timeout = setTimeout(() => { console.error('Electron smoke test exceeded 60 seconds'); child.kill() }, 60000)
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
clearTimeout(timeout)
process.exitCode = code ?? 1
