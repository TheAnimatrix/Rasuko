import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {SettingsStore} from '../src/main/settings/SettingsStore'
import {WorkspaceStore} from '../src/main/workspace/WorkspaceStore'
import {ChatService} from '../src/main/ai/ChatService'
import {registerIpc} from '../src/main/ipc/registerIpc'
import {installCloseGuard} from '../src/main/windows/closeGuard'
import {newId,nowIso} from '../src/shared/ids'
import {makeNode} from '../src/shared/viewOps'
import type {TableRecord} from '../src/shared/types'
app.setPath('userData',join(process.env.RASUKO_HOME!,'electron'))
void app.whenReady().then(async()=>{
 const settings=new SettingsStore(),workspace=new WorkspaceStore(settings),snapshot=workspace.load()
 const original=workspace.pagePayload(snapshot.activePageId!)!,pageId=original.page.id,projectId=original.page.projectId
 const second=workspace.createPage(projectId,{title:'Other page'})!
 workspace.openPage(pageId)
 const tableId=newId('record'),title=newId('block'),status=newId('block'),owner=newId('block'),due=newId('block'),estimate=newId('block'),priority=newId('block')
 const a=newId('block'),b=newId('block'),c=newId('block')
 workspace.createRecord(projectId,{id:tableId,kind:'table',label:'Shared work',createdAt:nowIso(),updatedAt:nowIso(),columns:[
  {id:title,name:'Title',type:'text'},{id:status,name:'Status',type:'select',options:['Todo','Doing','Done','Unassigned']},
  {id:owner,name:'Owner',type:'text'},{id:due,name:'Due date',type:'date'},{id:estimate,name:'Estimate',type:'number'},
  {id:priority,name:'Priority',type:'select',options:['High','Low']}
 ],rows:[{id:a,cells:{[title]:'Alpha',[status]:'Todo',[owner]:'Maya',[estimate]:3,[priority]:'High'}},{id:b,cells:{[title]:'Beta',[status]:'Todo',[owner]:'Leo',[estimate]:5,[priority]:'Low'}},{id:c,cells:{[title]:'Gamma',[status]:'Doing',[owner]:'Sam',[estimate]:2,[priority]:'High'}}]},pageId)
 workspace.applyViewOps(projectId,original.view.id,[{op:'setKind',kind:'custom'},{op:'setRoot',node:makeNode('page',{props:{width:'full',padding:16},children:[makeNode('kanban',{bind:{recordId:tableId},props:{titleField:title,groupBy:status,wipLimit:2}}),makeNode('table',{bind:{recordId:tableId}})]})}])
 const providers={catalog:()=>({providers:[]}),isEncryptedAtRest:()=>false} as any
 const chat=new ChatService(workspace,providers,settings)
 const window=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{preload:join(process.env.RASUKO_TEST_ROOT!,'out/preload/index.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,offscreen:true}})
 installCloseGuard(window)
 registerIpc({workspace,settings,providers,chat,getWindow:()=>window,applyThemeBackground:()=>{}})
 const errors:string[]=[]
 window.webContents.on('console-message',(details)=>{if(details.message.startsWith('Uncaught'))errors.push(details.message)})
 const evaluate=(code:string)=>window.webContents.executeJavaScript(code,true)
 const table=()=>workspace.getRecord(projectId,tableId) as TableRecord
 const recordExpr='window.rasuko.records.get('+JSON.stringify(projectId)+','+JSON.stringify(tableId)+')'
 async function until(code:string,label:string){for(let n=0;n<100;n++){if(await evaluate(code))return;await delay(60)}throw new Error('Timed out: '+label+'\n'+await evaluate('document.body.innerText.slice(0,2000)'))}
 async function click(text:string,scope='document'){assert.equal(await evaluate(`(()=>{const b=[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`),true,'Button: '+text)}
 async function fill(selector:string,value:string,commit=true){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing field');e.focus();e.dispatchEvent(new FocusEvent('focus',{bubbles:true}));e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));${commit?"e.blur();e.dispatchEvent(new FocusEvent('blur',{bubbles:true}));":''}})()`)}
 const dialog='document.querySelector("[role=dialog]")'
 const rowArticle=(name:string)=>`[...document.querySelectorAll('main article')].find(a=>a.querySelector('input[aria-label=Title]')?.value===${JSON.stringify(name)})`
 const output=join(process.env.RASUKO_TEST_ROOT!,'artifacts','interface-acceptance-2026-09-18');mkdirSync(output,{recursive:true})
 try{
  await window.loadFile(join(process.env.RASUKO_TEST_ROOT!,'out/renderer/index.html'))
  await until('document.querySelectorAll("main article").length===3','board with three cards')
  assert.ok(await evaluate(`document.fonts.load('600 14px Outfit').then(fonts=>fonts.length>0&&fonts.every(font=>font.status==='loaded'))`),'Bundled wordmark font loads offline')
  assert.ok(await evaluate('!!document.querySelector("main section[aria-label=Done]")'),'Empty lane')
  await click('Details',rowArticle('Alpha'))
  await until('!!document.querySelector("[role=dialog] input[aria-label=Owner]")','shared detail editor')
  await fill('[role=dialog] input[aria-label="Owner"]','Priya')
  await fill('[role=dialog] input[aria-label="Due date"]','2026-11-03')
  await fill('[role=dialog] input[aria-label="Estimate"]','13')
  await until(recordExpr+`.then(r=>r.rows.find(row=>row.id===${JSON.stringify(a)}).cells[${JSON.stringify(estimate)}]===13)`,'all typed fields saved')
  assert.equal(table().rows.find(r=>r.id===a)!.cells[owner],'Priya')
  assert.equal(table().rows.find(r=>r.id===b)!.cells[owner],'Leo')
  writeFileSync(join(output,'card-detail.png'),(await window.webContents.capturePage()).toPNG())
  await evaluate('document.querySelector("[role=dialog] button[aria-label=Close]").click()')
  await until('!document.querySelector("[role=dialog]")','dialog closed')
  await until('document.querySelector("main table input[aria-label=Owner]")?.value==="Priya"','table reflects card edits')
  await click('+ Add task','document.querySelector("main section[aria-label=Done]")')
  await until('!!document.querySelector("[role=dialog] input[aria-label=Title]")','create card form')
  assert.ok(await evaluate(`document.querySelector('[role=dialog] button[type=submit]').disabled`),'Blank cards cannot be created accidentally')
  await fill('[role=dialog] input[aria-label="Title"]','Created in Done')
  await fill('[role=dialog] input[aria-label="Owner"]','Taylor')
  await click('Create',dialog)
  await until(recordExpr+'.then(r=>r.rows.length===4)','created one complete card')
  const created=table().rows.find(r=>r.cells[title]==='Created in Done')!
  assert.equal(created.cells[status],'Done')
  assert.equal(created.cells[owner],'Taylor')
  await until('!document.querySelector("[role=dialog]")','create closes')
  await evaluate(`${rowArticle('Alpha')}.querySelector('button[aria-label="Move card down"]').click()`)
  await until(recordExpr+`.then(r=>r.rows.filter(x=>x.cells[${JSON.stringify(status)}]==='Todo')[0].id===${JSON.stringify(b)})`,'keyboard order persisted')
  await evaluate(`(()=>{const source=${rowArticle('Alpha')};source.dispatchEvent(new DragEvent('dragstart',{bubbles:true}));document.querySelector('main section[aria-label=Doing]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true}));})()`)
  await until(recordExpr+`.then(r=>r.rows.find(x=>x.id===${JSON.stringify(a)}).cells[${JSON.stringify(status)}]==='Doing')`,'drag moves only target')
  await click('Archive',rowArticle('Beta'))
  await until('document.querySelectorAll("main article").length===3','archived card hidden')
  // Undo is backed by the shared persisted action journal.
  await click('Undo','document.querySelector("main")')
  await until('document.querySelectorAll("main article").length===4','undo archive')
  await fill('main input[placeholder="New lane"]','Blocked',false)
  await click('Add','document.querySelector("main")')
  await until('!!document.querySelector("main section[aria-label=Blocked]")','empty lane created')
  assert.equal(table().columns.find(f=>f.id===status)!.options!.at(-1),'Blocked')
  await evaluate(`document.querySelector('main section[aria-label=Blocked] button[aria-label="Rename lane"]').click()`)
  await fill('main input[aria-label="Lane name"]','Waiting')
  await until('!!document.querySelector("main section[aria-label=Waiting]")','lane renamed by same schema ID')
  await fill('main input[aria-label="Search cards"]','Gamma',false)
  await until('document.querySelectorAll("main article").length===1','search changes only projection')
  assert.equal(table().rows.length,4)
  await fill('main input[aria-label="Search cards"]','',false)
  await until('document.querySelectorAll("main article").length===4','clear search')
  // An actual option named Unassigned must remain distinct from the empty group.
  await evaluate(`(()=>{const e=${rowArticle('Alpha')}.querySelector('select[aria-label="Move card"]');e.value='Unassigned';e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until(recordExpr+`.then(r=>r.rows.find(x=>x.id===${JSON.stringify(a)}).cells[${JSON.stringify(status)}]==='Unassigned')`,'named Unassigned option preserved')
  // Active text input, no blur: navigation must await the editor flush barrier.
  await fill('main table input[aria-label="Title"]','Saved before leaving',false)
  await click('Other page')
  await until('location.hash.includes('+JSON.stringify(second.page.id)+')','navigation flushed')
  await click('Notes')
  await until('[...document.querySelectorAll("main table input")].some(e=>e.value==="Saved before leaving")','pending text saved to original record')
  await window.webContents.reload()
  await until('document.querySelectorAll("main article").length===4','reloaded records and lane schema')
  assert.deepEqual(new Set(table().rows.map(r=>r.id)),new Set([a,b,c,created.id]))
  await click('View settings','document.querySelector("main")')
  await until('!!document.querySelector("[role=dialog]")','view inspector available')
  await evaluate(`[...document.querySelectorAll('[role=dialog] details')].find(d=>d.querySelector('summary')?.textContent.includes('Fields · Shared work')).open=true`)
  await fill('[role=dialog] input[aria-label="Field label"]','Work item')
  await until(recordExpr+`.then(r=>r.columns.find(c=>c.id===${JSON.stringify(title)}).name==='Work item')`,'field rename preserves stable schema ID')
  await evaluate('document.querySelector("[role=dialog] button[aria-label=Close]").click()')
  await until(`!!document.querySelector('main article input[aria-label="Work item"]')`,'board keeps the renamed title field')
  window.setSize(860,740)
  await delay(150)
  assert.ok(await evaluate('document.querySelector("main").getBoundingClientRect().width>=300'),'narrow pane remains usable')
  window.setSize(1440,960);await delay(150)
  writeFileSync(join(output,'shared-interface.png'),(await window.webContents.capturePage()).toPNG())
  // Native close flushes active fields; failure must keep the window available.
  await evaluate(`window.rejectClose=(e)=>e.detail.waitUntil(Promise.reject(new Error('Injected save failure')));window.addEventListener('rasuko:flush-editors',window.rejectClose)`)
  window.close();await delay(200)
  assert.equal(window.isDestroyed(),false,'Failed save blocks close')
  await until('document.body.innerText.includes("Injected save failure")','save error visible')
  await evaluate(`window.removeEventListener('rasuko:flush-editors',window.rejectClose)`)
  await fill('main table input[aria-label="Work item"]','Saved before close',false)
  await fill('input[aria-label="Page title"]','Title saved before close',false)
  const closed=new Promise<void>(resolve=>window.once('closed',()=>resolve()))
  window.close();await closed
  assert.ok(table().rows.some(r=>r.cells[title]==='Saved before close'),'Native close saved pending field')
  assert.equal(new WorkspaceStore(settings).snapshot().index.pages[pageId].title,'Title saved before close','Native close saved pending page title')
  assert.deepEqual(errors,[])
  writeFileSync(join(output,'ui-results.json'),JSON.stringify({passed:true,checks:['typed card fields','shared table projection','complete create','keyboard order','drag move','archive undo','empty lane add/rename','search','Unassigned identity','navigation flush','restart','narrow layout','close failure and save']},null,2))
  console.log('PASS: shared interface input/actions, stable lanes, multi-projection, restart, native close and failed-save retention')
  app.exit(0)
 }catch(error){console.error(error);if(!window.isDestroyed()) {console.error(await evaluate('document.body.innerText.slice(0,2500)'));writeFileSync(join(output,'ui-failure.png'),(await window.webContents.capturePage()).toPNG())}app.exit(1)}
}).catch(error=>{console.error(error);app.exit(1)})
