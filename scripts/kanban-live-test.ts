import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { SettingsStore } from '../src/main/settings/SettingsStore'
import { WorkspaceStore } from '../src/main/workspace/WorkspaceStore'
import { ProviderService } from '../src/main/providers/ProviderService'
import { ChatService } from '../src/main/ai/ChatService'
import { registerIpc } from '../src/main/ipc/registerIpc'
import { parseThinkingSuffixFromModelId } from '../src/shared/modelVariants'
import { newId } from '../src/shared/ids'
import type { ChatMessage, TableRecord, ViewNode } from '../src/shared/types'

app.setPath('userData', join(process.env.RASUKO_HOME!, 'electron'))
const outputDir = process.env.RASUKO_TEST_OUTPUT_DIR
  ?? join(process.env.RASUKO_TEST_ROOT!, 'artifacts', 'interface-acceptance-2026-09-18', 'new')
mkdirSync(outputDir, { recursive: true })

void app.whenReady().then(async () => {
  const settings = new SettingsStore()
  const selected = settings.get().assistant.model
  const providers = new ProviderService()
  console.log('Refreshing configured provider catalog:', selected.providerId, selected.model)
  await providers.init()
  const { baseId } = parseThinkingSuffixFromModelId(selected.model)
  assert.ok(providers.catalog().providers.find((p) => p.id === selected.providerId)?.configured, 'Selected provider has no readable saved credentials')
  assert.ok(providers.resolveModel(selected.providerId, baseId), 'Configured model is unavailable; refusing offline fallback')

  const workspace = new WorkspaceStore(settings)
  const initial = workspace.load()
  const pageId = initial.activePageId!
  const page = workspace.pagePayload(pageId)!
  const projectId = page.page.projectId
  const notesId = page.page.recordIds[0]
  if (!process.env.RASUKO_TEST_RESUME_HOME) {
    workspace.updatePage(pageId, { title: 'Launch board test' })
    workspace.updateRecord(projectId, notesId, { doc: { type: 'doc', blocks: [
      { id: newId('block'), type: 'paragraph', runs: [{ text: 'Launch goal: ship a useful private beta and collect feedback from five testers.' }] }
    ] } })
  }
  const chat = new ChatService(workspace, providers, settings)
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: {
    preload: join(process.env.RASUKO_TEST_ROOT!, 'out/preload/index.mjs'),
    contextIsolation: true, nodeIntegration: false, sandbox: false, offscreen: true
  } })
  registerIpc({ workspace, settings, providers, chat, getWindow: () => window, applyThemeBackground: () => undefined })
  const rendererErrors: string[] = []
  window.webContents.on('console-message', (details) => {
    if (details.message.startsWith('Uncaught')) rendererErrors.push(details.message)
  })
  const evaluate = (source: string) => window.webContents.executeJavaScript(source, true)
  const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
  function check(name: string, pass: boolean, detail?: unknown): void {
    checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) })
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`, detail === undefined ? '' : JSON.stringify(detail))
  }
  async function until(source: string, label: string, limit = 100): Promise<void> {
    for (let attempt = 0; attempt < limit; attempt++) {
      if (await evaluate(source)) return
      await delay(100)
    }
    throw new Error(`Timed out: ${label}`)
  }
  const prompts = [
    'Turn this page into a clean Kanban board for a small product launch. Use Backlog, In progress, Review, and Done columns. Create these six cards: Interview beta users (Backlog, Maya, High); Draft landing page (Backlog, Leo, Medium); Build signup flow (In progress, Maya, High); Write onboarding email (In progress, Leo, Medium); Review privacy copy (Review, Sam, High); Set up analytics (Done, Sam, Low). Show owner, priority, and a due-date field on each card. I want to add cards, edit titles, and move them between columns directly. Make the board the main interface, without extra metrics or a raw source editor. Keep my existing notes tucked away.'
  ]
  const broadcast = chat.onEvent
  let resolveTurn: ((message: ChatMessage) => void) | null = null
  chat.onEvent = (event) => {
    broadcast(event)
    if (event.type === 'tool_start') console.log('AI tool:', event.name)
    if (event.type === 'tool_end') console.log('AI tool result:', event.id, event.isError ? 'error' : 'ok')
    if (event.type === 'turn_end') resolveTurn?.(event.message)
  }
  async function ask(prompt: string): Promise<ChatMessage> {
    await until('!!document.querySelector("button[aria-label=\\"Chat history\\"]:not(:disabled)")', 'chat ready')
    const reply = new Promise<ChatMessage>((resolve, reject) => {
      const timeout = setTimeout(() => { chat.abort(pageId); reject(new Error('AI turn exceeded 150 seconds')) }, 150000)
      resolveTurn = (message) => { clearTimeout(timeout); resolve(message) }
    })
    await evaluate(`(() => { const e = document.querySelector('textarea[placeholder="Ask anything…"]'); e.value = ${JSON.stringify(prompt)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
    const message = await reply
    resolveTurn = null
    console.log('AI reply:', JSON.stringify({ text: message.text, error: message.error, tools: message.toolCalls?.map((call) => ({ name: call.name, isError: call.isError })) }))
    return message
  }
  function nodes(node: ViewNode): ViewNode[] { return [node, ...(node.children ?? []).flatMap(nodes)] }
  function board(): { node: ViewNode; record: TableRecord } | null {
    const payload = workspace.pagePayload(pageId)!
    const node = nodes(payload.view.root).find((n) => n.type === 'kanban')
    const record = node?.bind && payload.records[node.bind.recordId]
    return node && record && record.kind === 'table' ? { node, record } : null
  }
  function validInspectionReceipt(message: ChatMessage): boolean {
    return Boolean(message.toolCalls?.some((call) => {
      if (!['view_inspect', 'view_applyOps'].includes(call.name) || call.isError || !call.output) return false
      try {
        const receipt = JSON.parse(call.output)
        return call.name === 'view_inspect' ? receipt.valid === true : receipt.inspection?.valid === true
      } catch { return false }
    }))
  }
  function artifact(name: string, data: unknown): void { writeFileSync(join(outputDir, name), JSON.stringify(data, null, 2)) }
  try {
    await window.loadFile(join(process.env.RASUKO_TEST_ROOT!, 'out/renderer/index.html'))
    await until('!!document.querySelector("main")', 'page loaded')
    await evaluate('document.querySelector("button[aria-label=\\"Show assistant\\"]")?.click()')
    if (process.env.RASUKO_TEST_CORRECT_ONLY) {
      const correction = 'The Kanban renderer supports empty lanes through the Status column schema: set that table column to type select with options Backlog, In progress, Review, Done, Blocked. Please use record_update to make this schema change, keeping every column ID, row ID, cell value, and the seven cards unchanged. Do not add a placeholder row or redesign the View.'
      const before = board()!
      const message = await ask(correction)
      const after = board()!
      const status = after.record.columns.find((c) => c.name === 'Status')!
      check('Coached AI request completes', !message.error)
      check('Coached AI adds explicit five-lane status options', status.type === 'select' && ['Backlog', 'In progress', 'Review', 'Done', 'Blocked'].every((s) => status.options?.includes(s)), status)
      check('Coached schema edit preserves all seven cards and IDs', JSON.stringify(before.record.rows) === JSON.stringify(after.record.rows) && after.record.rows.length === 7 && before.record.id === after.record.id)
      await until('document.querySelector("main").innerText.includes("Blocked")', 'empty Blocked column rendered')
      check('Empty Blocked column renders', true)
      await evaluate('document.querySelector("button[aria-label=\\"Hide assistant\\"]")?.click()')
      await delay(200)
      writeFileSync(join(outputDir, 'kanban-corrected.png'), (await window.webContents.capturePage()).toPNG())
      artifact('correction-results.json', { model: selected, prompt: correction, checks, reply: message.text, passed: checks.every((c) => c.pass) })
      artifact('corrected-page.json', workspace.pagePayload(pageId))
      artifact('conversation.json', chat.current(pageId))
      providers.stop()
      app.exit(checks.every((c) => c.pass) ? 0 : 1)
      return
    }
    const first = process.env.RASUKO_TEST_RESUME_HOME
      ? chat.history(pageId).find((message) => message.role === 'assistant')!
      : await ask(prompts[0])
    check('Real configured-model reply completed without provider error', !first.error, selected)
    const created = board()
    check('AI produced a bound Kanban component', Boolean(created))
    if (!created) throw new Error('The AI did not produce a bound Kanban')
    const status = created.record.columns.find((column) => column.id === created.node.props?.groupBy || column.name === created.node.props?.groupBy)
    const title = created.record.columns.find((column) => column.id === created.node.props?.titleField || column.name === created.node.props?.titleField)
    check('All six requested cards were created', created.record.rows.length === 6, created.record.rows.length)
    check('Status schema preserves the four requested lanes', status?.type === 'select' && ['Backlog', 'In progress', 'Review', 'Done'].every((s) => status.options?.includes(s)), status)
    check('Owner, priority, and due-date fields exist', ['owner', 'priority'].every((s) => created.record.columns.some((c) => c.name.toLowerCase() === s)) && created.record.columns.some((c) => /due/i.test(c.name)), created.record.columns)
    assert.ok(title && status, 'Board title/status bindings must resolve')
    check('Kanban props use stable column IDs', created.node.props?.groupBy === status.id && created.node.props?.titleField === title.id, created.node.props)
    check('Initial AI validates the finished interface', validInspectionReceipt(first), first.toolCalls?.map((call) => call.name))
    const owner = created.record.columns.find((column) => column.name.toLowerCase() === 'owner')!
    const priority = created.record.columns.find((column) => column.name.toLowerCase() === 'priority')!
    const due = created.record.columns.find((column) => /due/i.test(column.name))!
    const cardSelector = JSON.stringify('main article[draggable="true"] input[aria-label=' + JSON.stringify(title.name) + ']')
    await until('document.querySelectorAll(' + cardSelector + ').length===6', 'six editable board cards')
    await delay(300)
    await evaluate('document.querySelector("button[aria-label=\\"Hide assistant\\"]")?.click()')
    await delay(150)
    writeFileSync(join(outputDir, 'kanban-created.png'), (await window.webContents.capturePage()).toPNG())
    artifact('created-page.json', workspace.pagePayload(pageId))

    const newTitle = 'Interview five beta users'
    await evaluate(`(() => { const e = [...document.querySelectorAll('main article input')].find(e => e.value === 'Interview beta users'); if (!e) throw new Error('Seed card not visible'); e.focus(); e.value = ${JSON.stringify(newTitle)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); e.dispatchEvent(new FocusEvent('blur', { bubbles: true })); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.some(row=>Object.values(row.cells).includes(' + JSON.stringify(newTitle) + ')))', 'renamed card saved')
    check('Card title input event and Enter commit directly', true)
    await evaluate(`(() => { const card = [...document.querySelectorAll('main article')].find(card => [...card.querySelectorAll('input')].some(e => e.value === ${JSON.stringify(newTitle)})); const e = card?.querySelector('select[aria-label="Move card"]'); if (!e) throw new Error('Move control absent'); e.value = 'Review'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.some(row=>row.cells[' + JSON.stringify(title.id) + ']===' + JSON.stringify(newTitle) + '&&row.cells[' + JSON.stringify(status.id) + ']==="Review"))', 'card moved')
    check('Card status change event moves between lanes', true)

    await evaluate(`(() => { const card = [...document.querySelectorAll('main article')].find(card => [...card.querySelectorAll('input')].some(e => e.value === ${JSON.stringify(newTitle)})); const e = [...(card?.querySelectorAll('button') ?? [])].find(e => e.textContent.trim() === 'Details'); if (!e) throw new Error('Details absent'); e.click(); })()`)
    await until('[...document.querySelectorAll("[role=dialog]")].some(d=>d.innerText.includes("Edit card"))', 'edit card dialog')
    await evaluate(`(() => { const dialog = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('Edit card')); const changes = ${JSON.stringify({ [owner.name]: 'Priya', [priority.name]: priority.options?.includes('High') ? 'High' : 'High', [due.name]: '2026-10-15' })}; for (const [name,value] of Object.entries(changes)) { const label = [...dialog.querySelectorAll('label')].find(l => l.innerText.trim().startsWith(name)); const e = label?.querySelector('input,select,textarea'); if (!e) throw new Error('Missing detail field '+name); e.focus(); e.value=value; e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true})); if(e.tagName!=='SELECT') e.dispatchEvent(new FocusEvent('blur',{bubbles:true})); } })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.some(row=>row.cells[' + JSON.stringify(title.id) + ']===' + JSON.stringify(newTitle) + '&&row.cells[' + JSON.stringify(owner.id) + ']==="Priya"&&row.cells[' + JSON.stringify(priority.id) + ']==="High"&&row.cells[' + JSON.stringify(due.id) + ']==="2026-10-15"))', 'detail fields saved')
    check('Detail dialog edits owner, priority, and due date', true)
    await evaluate(`document.querySelector('[role=dialog] button[aria-label="Close"]')?.click()`)

    const seventhTitle = 'Schedule launch review'
    await evaluate(`(() => { const lane = document.querySelector('main section[aria-label="Backlog"]'); const e = [...(lane?.querySelectorAll('button') ?? [])].find(e => e.textContent.trim() === '+ Add task'); if (!e) throw new Error('Add task absent'); e.click(); })()`)
    await until('[...document.querySelectorAll("[role=dialog]")].some(d=>d.innerText.includes("Create card"))', 'create card dialog')
    await evaluate(`(() => { const dialog = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('Create card')); const changes = ${JSON.stringify({ [title.name]: seventhTitle, [owner.name]: 'Nora', [priority.name]: priority.options?.includes('Medium') ? 'Medium' : 'Medium', [due.name]: '2026-10-20' })}; for (const [name,value] of Object.entries(changes)) { const label = [...dialog.querySelectorAll('label')].find(l => l.innerText.trim().startsWith(name)); const e = label?.querySelector('input,select,textarea'); if (!e) throw new Error('Missing create field '+name); e.focus(); e.value=value; e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true})); if(e.tagName!=='SELECT') e.dispatchEvent(new FocusEvent('blur',{bubbles:true})); } const create=[...dialog.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create'); if(!create) throw new Error('Create absent'); create.click(); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.length===7)', 'new card saved')
    const createdSeventh = workspace.getRecord(projectId, created.record.id) as TableRecord
    const seventhRow = createdSeventh.rows.find((row) => row.cells[title.id] === seventhTitle)!
    check('Create dialog saves a complete seventh card', Boolean(seventhRow) && seventhRow.cells[status.id] === 'Backlog' && seventhRow.cells[owner.id] === 'Nora' && seventhRow.cells[priority.id] === 'Medium' && seventhRow.cells[due.id] === '2026-10-20', seventhRow)

    const beforeKeyboardOrder = createdSeventh.rows.map((row) => row.id)
    await evaluate(`(() => { const card = [...document.querySelectorAll('main article')].find(card => [...card.querySelectorAll('input')].some(e => e.value === ${JSON.stringify(seventhTitle)})); const up=card?.querySelector('button[aria-label="Move card up"]'); if(!up || up.disabled) throw new Error('Keyboard ordering control unavailable'); up.click(); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.findIndex(row=>row.id===' + JSON.stringify(seventhRow.id) + ')<' + beforeKeyboardOrder.indexOf(seventhRow.id) + ')', 'keyboard card reorder')
    check('Keyboard-accessible ordering control changes stable row order', true)

    await evaluate(`(() => { const card = [...document.querySelectorAll('main article')].find(card => [...card.querySelectorAll('input')].some(e => e.value === ${JSON.stringify(seventhTitle)})); const lane=document.querySelector('main section[aria-label="Done"]'); if(!card||!lane) throw new Error('Drag endpoints absent'); card.dispatchEvent(new DragEvent('dragstart',{bubbles:true})); lane.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true})); card.dispatchEvent(new DragEvent('dragend',{bubbles:true})); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.some(row=>row.id===' + JSON.stringify(seventhRow.id) + '&&row.cells[' + JSON.stringify(status.id) + ']==="Done"))', 'drag move saved')
    check('Drag move changes lane while preserving row ID', true)

    await evaluate(`(() => { const card = [...document.querySelectorAll('main article')].find(card => [...card.querySelectorAll('input')].some(e => e.value === ${JSON.stringify(seventhTitle)})); const archive=[...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Archive'); if(!archive) throw new Error('Archive absent'); archive.click(); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.some(row=>row.id===' + JSON.stringify(seventhRow.id) + '&&row.archived===true))', 'archive saved')
    await evaluate(`(() => { const archived=[...document.querySelectorAll('main button')].find(b=>b.textContent.trim().startsWith('Archived ')); if(!archived) throw new Error('Archived control absent'); archived.click(); })()`)
    await until('[...document.querySelectorAll("main button")].some(b=>b.textContent.trim()==="Restore")', 'restore control')
    await evaluate(`(() => { const restore=[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Restore'); if(!restore) throw new Error('Restore absent'); restore.click(); })()`)
    await until('window.rasuko.records.get(' + JSON.stringify(projectId) + ',' + JSON.stringify(created.record.id) + ').then(r=>r.rows.some(row=>row.id===' + JSON.stringify(seventhRow.id) + '&&!row.archived))', 'restore saved')
    check('Archive and restore preserve card identity', true)

    const beforeReload = JSON.stringify(workspace.getRecord(projectId, created.record.id))
    await window.webContents.reload()
    await until('document.querySelectorAll(' + cardSelector + ').length===7', 'saved board after reload')
    check('Cards and edits survive renderer reload', beforeReload === JSON.stringify(workspace.getRecord(projectId, created.record.id)))

    await evaluate('document.querySelector("button[aria-label=\\"Show assistant\\"]")?.click()')
    const beforeAi = board()!
    const beforeRowIds = beforeAi.record.rows.map((row) => row.id)
    const beforeColumnIds = beforeAi.record.columns.map((column) => column.id)
    const beforeStatusOptions = [...(beforeAi.record.columns.find((column) => column.id === status.id)?.options ?? [])]
    const renameRowId = beforeAi.record.rows.find((row) => row.cells[title.id] === 'Review privacy copy')?.id
    const moveRowId = beforeAi.record.rows.find((row) => row.cells[title.id] === newTitle)?.id
    const followup = 'Check the current board. Rename the card "Review privacy copy" to "Approve privacy copy", move "Interview five beta users" to Done, and add an empty Blocked lane. Preserve this table, all seven row IDs, every column ID, all other values, and the existing lane order. Make only these changes, use narrow stable-ID record actions, then inspect the View.'
    prompts.push(followup)
    const second = await ask(followup)
    check('Follow-up AI reply completed without provider error', !second.error)
    const updated = board()!
    const updatedTitle = updated.record.columns.find((c) => c.id === title.id) ?? updated.record.columns.find((c) => c.name === title.name)!
    const updatedStatus = updated.record.columns.find((c) => c.id === status.id) ?? updated.record.columns.find((c) => c.name === status.name)!
    check('AI sees manual edits and moves the renamed card to Done', updated.record.rows.some((row) => row.cells[updatedTitle.id] === newTitle && row.cells[updatedStatus.id] === 'Done'))
    check('AI narrowly renames the requested card', updated.record.rows.some((row) => row.cells[updatedTitle.id] === 'Approve privacy copy'))
    check('AI keeps seven cards and adds an empty Blocked lane', updated.record.rows.length === 7 && Boolean(updatedStatus.options?.includes('Blocked')), { cards: updated.record.rows.length, lanes: updatedStatus.options })
    check('Blocked lane stays empty', !updated.record.rows.some((row) => row.cells[updatedStatus.id] === 'Blocked'))
    check('Existing lane order is preserved', JSON.stringify((updatedStatus.options ?? []).filter((option) => option !== 'Blocked')) === JSON.stringify(beforeStatusOptions), { before: beforeStatusOptions, after: updatedStatus.options })
    check('Follow-up preserves original board record identity', updated.record.id === created.record.id)
    check('Follow-up preserves all stable row and column IDs', JSON.stringify(updated.record.rows.map((row) => row.id).sort()) === JSON.stringify([...beforeRowIds].sort()) && JSON.stringify(updated.record.columns.map((column) => column.id)) === JSON.stringify(beforeColumnIds), { beforeRowIds, afterRowIds: updated.record.rows.map((row) => row.id), beforeColumnIds, afterColumnIds: updated.record.columns.map((column) => column.id) })
    const narrowValues = beforeAi.record.rows.every((beforeRow) => {
      const afterRow = updated.record.rows.find((row) => row.id === beforeRow.id)
      if (!afterRow) return false
      return Object.keys(beforeRow.cells).every((columnId) => {
        if (beforeRow.id === renameRowId && columnId === title.id) return afterRow.cells[columnId] === 'Approve privacy copy'
        if (beforeRow.id === moveRowId && columnId === status.id) return afterRow.cells[columnId] === 'Done'
        return afterRow.cells[columnId] === beforeRow.cells[columnId]
      })
    })
    check('Follow-up preserves every unrelated cell value', narrowValues)
    check('Follow-up uses narrow record actions', Boolean(second.toolCalls?.some((call) => call.name === 'record_action' && !call.isError)), second.toolCalls?.map((call) => call.name))
    check('Follow-up validates the finished interface', validInspectionReceipt(second), second.toolCalls?.map((call) => call.name))
    check('Original notes survive', workspace.getRecord(projectId, notesId)?.kind === 'richtext')
    check('No uncaught renderer errors', rendererErrors.length === 0, rendererErrors)
    await delay(300)
    await evaluate('document.querySelector("button[aria-label=\\"Hide assistant\\"]")?.click()')
    await delay(150)
    writeFileSync(join(outputDir, 'kanban-after-edits.png'), (await window.webContents.capturePage()).toPNG())
    artifact('final-page.json', workspace.pagePayload(pageId))
    artifact('conversation.json', chat.current(pageId))
    artifact('results.json', { model: selected, prompts, checks, passed: checks.every((c) => c.pass), rendererErrors, testedAt: new Date().toISOString() })
    console.log('Live Kanban results:', checks.filter((c) => c.pass).length, '/', checks.length, 'passed')
    providers.stop()
    app.exit(checks.every((c) => c.pass) ? 0 : 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    artifact('results.json', { model: selected, prompts, checks, passed: false, error: message, rendererErrors, testedAt: new Date().toISOString() })
    artifact('conversation.json', chat.current(pageId))
    artifact('final-page.json', workspace.pagePayload(pageId))
    try { writeFileSync(join(outputDir, 'kanban-failure.png'), (await window.webContents.capturePage()).toPNG()) } catch {}
    console.error(message)
    providers.stop()
    app.exit(1)
  }
}).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); app.exit(1) })
