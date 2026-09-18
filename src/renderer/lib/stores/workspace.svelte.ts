import type { ContentRecord, PageMeta, ProjectMeta, ViewDoc, WorkspaceIndex } from '@shared/types'
import type { ViewOp } from '@shared/viewOps'
import type { RecordAction, RecordActionReceipt } from '@shared/recordActions'
import { flushEditors } from '$lib/flushEditors'

export interface WorkspaceSnapshot {
  index: WorkspaceIndex
  activePageId: string | null
}

export interface PagePayload {
  page: PageMeta
  view: ViewDoc
  records: Record<string, ContentRecord>
  orphaned: ContentRecord[]
}

/**
 * Renderer mirror of the workspace.
 *
 * Every mutation goes through the main process, which re-broadcasts a snapshot.
 * The page payload is re-fetched whenever the assistant may have touched it.
 */
class WorkspaceState {
  index = $state<WorkspaceIndex | null>(null)
  activePageId = $state<string | null>(null)
  payload = $state<PagePayload | null>(null)
  /** Increments on every broadcast. A primitive signal consumers can depend on. */
  lastMutation = $state(0)
  loading = $state(true)
  error = $state<string | null>(null)
  #unsubscribe: (() => void) | null = null
  #payloadRequest = 0
  #openRequest = 0

  get projects(): ProjectMeta[] {
    return this.index?.projects ?? []
  }

  pagesFor(projectId: string): PageMeta[] {
    const ids = this.index?.projectPages[projectId] ?? []
    return ids
      .map((id) => this.index?.pages[id])
      .filter((page): page is PageMeta => page !== undefined && !page.trashed)
  }

  get activePage(): PageMeta | null {
    if (!this.activePageId || !this.index) return null
    return this.index.pages[this.activePageId] ?? null
  }

  get activeProjectId(): string | null {
    return this.activePage?.projectId ?? this.projects[0]?.id ?? null
  }

  async init(): Promise<void> {
    try {
      const snapshot = await window.rasuko.workspace.snapshot()
      this.applySnapshot(snapshot)
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the workspace'
    } finally {
      this.loading = false
    }

    if (!this.#unsubscribe) {
      this.#unsubscribe = window.rasuko.workspace.onChanged((snapshot) => {
        this.applySnapshot(snapshot)
      })
    }
  }

  private applySnapshot(snapshot: WorkspaceSnapshot): void {
    this.index = snapshot.index
    this.lastMutation += 1
    this.activePageId = snapshot.activePageId
    // Any workspace mutation — including the assistant applying view ops or
    // creating records in the main process — must re-read the page payload.
    // Otherwise the open page keeps rendering a View that no longer exists.
    if (this.activePageId) void this.refreshPayload(this.activePageId)
    else this.payload = null
  }

  async openPage(pageId: string): Promise<void> {
    const request = ++this.#openRequest
    const payload = await window.rasuko.workspace.openPage(pageId)
    if (payload && request === this.#openRequest) {
      this.payload = payload
      this.activePageId = payload.page.id
    }
  }

  /**
   * Re-read the active page. Last response wins for a given page; a response for
   * a page that is no longer open is discarded so rapid navigation cannot render
   * the wrong document.
   */
  async refreshPayload(pageId = this.activePageId): Promise<void> {
    if (!pageId) return
    const request = ++this.#payloadRequest
    const payload = await window.rasuko.workspace.pagePayload(pageId)
    if (!payload || request !== this.#payloadRequest) return
    if (payload.page.id !== this.activePageId) return
    this.payload = payload
  }

  async createProject(name?: string): Promise<ProjectMeta> {
    const project = await window.rasuko.workspace.createProject(name)
    await this.init()
    return project
  }

  async renameProject(id: string, name: string): Promise<void> {
    await window.rasuko.workspace.updateProject(id, { name })
  }

  async deleteProject(id: string): Promise<void> {
    await window.rasuko.workspace.deleteProject(id)
    await this.refreshPayload()
  }

  async createPage(projectId: string, init: { title?: string; markdown?: boolean; viewId?: string } = {}): Promise<PageMeta | null> {
    try { await flushEditors() } catch { return null }
    const payload = await window.rasuko.workspace.createPage(projectId, init)
    if (!payload) return null
    this.payload = payload
    this.activePageId = payload.page.id
    return payload.page
  }

  async renamePage(pageId: string, title: string): Promise<void> {
    await window.rasuko.workspace.updatePage(pageId, { title })
  }

  async setPageMarkdown(pageId: string, markdown: boolean): Promise<void> {
    await window.rasuko.workspace.updatePage(pageId, { markdown })
    if (this.payload?.page.id === pageId) {
      this.payload = { ...this.payload, page: { ...this.payload.page, markdown } }
    }
  }

  async deletePage(pageId: string, hard = false): Promise<void> {
    await flushEditors()
    const wasActive = this.activePageId === pageId
    await window.rasuko.workspace.deletePage(pageId, hard)
    if (wasActive) {
      const next = this.projects.flatMap((p) => this.pagesFor(p.id))[0]
      if (next) await this.openPage(next.id)
      else {
        this.payload = null
        this.activePageId = null
      }
    }
  }

  async movePage(projectId: string, pageId: string, index: number): Promise<void> {
    await window.rasuko.workspace.movePage(projectId, pageId, index)
  }

  /* --------------------------------- records -------------------------------- */

  private receiveRecord(updated: ContentRecord, projectId: string): void {
    if (this.payload?.page.projectId === projectId && this.payload.page.recordIds.includes(updated.id)) {
      const existing = this.payload.records[updated.id]
      if ((existing?.revision ?? 0) > (updated.revision ?? 0)) return
      this.payload = { ...this.payload, records: { ...this.payload.records, [updated.id]: updated } }
    }
  }

  async runRecordAction(recordId: string, action: RecordAction, projectId = this.payload?.page.projectId): Promise<RecordActionReceipt> {
    if (!projectId) throw new Error('Open a project before editing')
    const receipt = await window.rasuko.records.action(projectId, recordId, $state.snapshot(action))
    this.receiveRecord(receipt.record, projectId)
    return receipt
  }

  async undoRecordAction(recordId: string, projectId = this.payload?.page.projectId): Promise<RecordActionReceipt | null> {
    if (!projectId) throw new Error('Open a project before editing')
    const receipt = await window.rasuko.records.undoAction(projectId, recordId)
    if (receipt) this.receiveRecord(receipt.record, projectId)
    return receipt
  }

  async updateRecord(recordId: string, patch: Partial<ContentRecord>, projectId = this.payload?.page.projectId): Promise<void> {
    if (!projectId) return
    const updated = await window.rasuko.records.update(projectId, recordId, $state.snapshot(patch))
    if (updated) this.receiveRecord(updated, projectId)
  }

  async createRecord(record: ContentRecord, target?: { projectId: string; pageId: string }): Promise<ContentRecord | null> {
    const projectId = target?.projectId ?? this.payload?.page.projectId
    const pageId = target?.pageId ?? this.payload?.page.id
    if (!projectId || !pageId) return null
    const created = await window.rasuko.records.create(projectId, $state.snapshot(record), pageId)
    if (this.activePageId === pageId) await this.refreshPayload(pageId)
    return created
  }

  /* ---------------------------------- views --------------------------------- */

  async applyOps(ops: ViewOp[], summary?: string): Promise<void> {
    const projectId = this.payload?.page.projectId
    const viewId = this.payload?.view.id
    if (!projectId || !viewId) return
    await window.rasuko.view.applyOps(projectId, viewId, $state.snapshot(ops), summary, this.payload?.view.revision ?? 0)
    await this.refreshPayload()
  }

  async reattach(recordId: string, nodeId: string): Promise<void> {
    const projectId = this.payload?.page.projectId
    const viewId = this.payload?.view.id
    if (!projectId || !viewId) return
    await window.rasuko.records.reattach(projectId, viewId, recordId, nodeId)
    await this.refreshPayload()
  }

  async saveView(view: ViewDoc): Promise<void> {
    const projectId = this.payload?.page.projectId
    if (!projectId) return
    await window.rasuko.view.save(projectId, $state.snapshot(view), view.revision ?? 0)
    await this.refreshPayload()
  }

  async revertToBarebones(): Promise<void> {
    const projectId = this.payload?.page.projectId
    const viewId = this.payload?.view.id
    if (!projectId || !viewId || !this.payload) return
    const richRecord = Object.values(this.payload.records).find((r) => r.kind === 'richtext')
    const ops: ViewOp[] = [
      { op: 'setKind', kind: 'barebones' },
      { op: 'setName', name: this.payload.page.title || 'Notes' },
      ...(this.payload.view.root.children ?? []).map<ViewOp>((child) => ({
        op: 'remove',
        target: child.id
      })),
      {
        op: 'insert',
        parent: this.payload.view.root.id,
        index: 0,
        node: { id: '', type: 'rich', props: { editable: true, showToolbar: true }, ...(richRecord ? { bind: { recordId: richRecord.id } } : {}) }
      }
    ]
    await window.rasuko.view.applyOps(projectId, viewId, ops, 'Reverted to the minimal writing surface')
    await this.refreshPayload()
  }
}

export const workspace = new WorkspaceState()
