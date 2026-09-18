import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  type ContentRecord,
  type PageMeta,
  type ProjectMeta,
  type ViewDoc,
  type WorkspaceIndex,
  WORKSPACE_VERSION
} from '@shared/types'
import { emptyDoc, normalizeDoc } from '@shared/richtext'
import { isId, newId, nowIso } from '@shared/ids'
import { barebonesView, coerceView, collectBindings, applyViewOps, type ViewOp, type ApplyResult } from '@shared/viewOps'
import { getComponent } from '@shared/viewSchema'
import { assertValidRecord, assertValidView, validateViewDoc } from '@shared/viewValidation'
import {
  pagePath,
  projectDir,
  projectFilePath,
  projectPagesDir,
  projectRecordsDir,
  projectViewsDir,
  recordPath,
  settingsPath,
  viewPath,
  workspaceIndexPath,
  workspaceRoot
} from '../paths'
import { atomicWriteJsonSync, ensureDir, ensureDir as ensure, quarantineSync, readJsonSync } from '../io/atomic'
import type { SettingsStore } from '../settings/SettingsStore'
import { commitFileTransaction, jsonContents, recoverIncompleteFileTransactions, type FileMutation } from './FileTransaction'

export interface PagePayload {
  page: PageMeta
  view: ViewDoc
  records: Record<string, ContentRecord>
  orphaned: ContentRecord[]
}

export interface WorkspaceSnapshot {
  index: WorkspaceIndex
  activePageId: string | null
}

export interface ManagedWriteResult {
  content: string
  isError?: boolean
  details?: Record<string, unknown>
}

type Revisioned = { revision?: number; schemaVersion?: number }

export class RevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT'
  constructor(
    readonly entity: 'record' | 'view',
    readonly entityId: string,
    readonly expected: number,
    readonly actual: number
  ) {
    super(`Stale ${entity} ${entityId}: expected revision ${expected}, current revision is ${actual}`)
    this.name = 'RevisionConflictError'
  }
}

function revisionOf(entity: object): number {
  const revision = (entity as Revisioned).revision
  return Number.isSafeInteger(revision) && revision! >= 0 ? revision! : 0
}

function withRevision<T extends object>(entity: T, revision: number): T {
  return { ...entity, revision, schemaVersion: (entity as Revisioned).schemaVersion ?? 1 }
}

/**
 * The workspace owns every durable entity. Layout on disk (see ARCHITECTURE.md)
 * deliberately separates views from records so content survives redesigns and
 * the assistant can operate with ordinary file tools.
 */
export class WorkspaceStore {
  private index: WorkspaceIndex | null = null
  private activePageId: string | null = null
  /** In-memory mirrors to avoid re-reading the disk on hot paths. */
  private viewCache = new Map<string, ViewDoc>()
  private recordCache = new Map<string, ContentRecord>()
  private listeners = new Set<(snapshot: WorkspaceSnapshot) => void>()

  constructor(private readonly settings: SettingsStore) {}

  /* ------------------------------ lifecycle ----------------------------- */

  load(): WorkspaceSnapshot {
    if (this.index) return { index: this.index, activePageId: this.activePageId }
    ensure(workspaceRoot())
    recoverIncompleteFileTransactions(workspaceRoot())
    let index = readJsonSync<WorkspaceIndex>(workspaceIndexPath())
    if (!index || typeof index !== 'object' || !Array.isArray(index.projects)) {
      if (existsSync(workspaceIndexPath())) quarantineSync(workspaceIndexPath())
      index = this.seed()
    }
    this.index = this.normalizeIndex(index)
    this.activePageId =
      this.index.projects[0] && this.index.projectPages[this.index.projects[0].id]?.[0]
        ? this.index.projectPages[this.index.projects[0].id][0]
        : null
    return { index: this.index, activePageId: this.activePageId }
  }

  onChange(listener: (snapshot: WorkspaceSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  snapshot(): WorkspaceSnapshot {
    this.load()
    return { index: this.index!, activePageId: this.activePageId }
  }

  private normalizeIndex(index: WorkspaceIndex): WorkspaceIndex {
    const projects = (index.projects ?? []).filter((p): p is ProjectMeta => Boolean(p?.id))
    const pages = index.pages ?? {}
    const projectPages: Record<string, string[]> = {}
    const projectViews: Record<string, string[]> = {}
    for (const project of projects) {
      projectPages[project.id] = (index.projectPages?.[project.id] ?? []).filter((id) => Boolean(pages[id]))
      projectViews[project.id] = index.projectViews?.[project.id] ?? []
    }
    return {
      version: WORKSPACE_VERSION,
      projects,
      pages,
      projectPages,
      projectViews,
      updatedAt: index.updatedAt ?? nowIso()
    }
  }

  /* -------------------------------- seeding ----------------------------- */

  private seed(): WorkspaceIndex {
    const now = nowIso()
    const projectId = newId('project')
    const pageId = newId('page')
    const viewId = newId('view')
    const recordId = newId('record')

    ensure(projectDir(projectId))
    ensure(projectPagesDir(projectId))
    ensure(projectViewsDir(projectId))
    ensure(projectRecordsDir(projectId))

    const view = { ...barebonesView('Notes'), id: viewId }
    view.root.children = []
    // Barebones pages bind a single richtext record through the `rich` node.
    const richNode = view.root.children?.[0] ?? null
    if (view.root.children === undefined) view.root.children = []
    const builtRich = richNode ?? { id: newId('node'), type: 'rich', props: { editable: true, showToolbar: true } }

    const doc = emptyDoc()

    const record: ContentRecord = {
      id: recordId,
      kind: 'richtext',
      label: 'Notes',
      doc,
      createdAt: now,
      updatedAt: now
    }

    builtRich.bind = { recordId }
    view.root.children = [builtRich]

    const project: ProjectMeta = {
      id: projectId,
      name: 'My Workspace',
      icon: 'folder-line',
      createdAt: now,
      updatedAt: now
    }
    const page: PageMeta = {
      id: pageId,
      projectId,
      title: 'Notes',
      icon: 'file-line',
      viewId,
      recordIds: [recordId],
      markdown: false,
      createdAt: now,
      updatedAt: now
    }

    const workspace: WorkspaceIndex = {
      version: WORKSPACE_VERSION,
      projects: [project],
      pages: { [pageId]: page },
      projectPages: { [projectId]: [pageId] },
      projectViews: { [projectId]: [viewId] },
      updatedAt: now
    }
    commitFileTransaction(workspaceRoot(), 'Create blank workspace', [
      { path: projectFilePath(projectId), contents: jsonContents(project) },
      { path: pagePath(projectId, pageId), contents: jsonContents(page) },
      { path: viewPath(projectId, viewId), contents: jsonContents(view) },
      { path: recordPath(projectId, recordId), contents: jsonContents(record) },
      { path: workspaceIndexPath(), contents: jsonContents(workspace) }
    ])
    return workspace
  }

  private persistIndex(): void {
    this.index!.updatedAt = nowIso()
    atomicWriteJsonSync(workspaceIndexPath(), this.index!)
  }

  /* ------------------------------- projects ----------------------------- */

  createProject(name = 'New project'): ProjectMeta {
    this.load()
    const now = nowIso()
    const project: ProjectMeta = {
      id: newId('project'),
      name: name.trim() || 'New project',
      icon: 'folder-line',
      createdAt: now,
      updatedAt: now
    }
    ensure(projectDir(project.id))
    ensure(projectPagesDir(project.id))
    ensure(projectViewsDir(project.id))
    ensure(projectRecordsDir(project.id))
    atomicWriteJsonSync(projectFilePath(project.id), project)
    this.index!.projects.push(project)
    this.index!.projectPages[project.id] = []
    this.index!.projectViews[project.id] = []
    this.persistIndex()
    this.emit()
    return project
  }

  updateProject(projectId: string, patch: Partial<Pick<ProjectMeta, 'name' | 'icon' | 'color' | 'description' | 'pinned'>>): ProjectMeta | null {
    this.load()
    const project = this.index!.projects.find((p) => p.id === projectId)
    if (!project) return null
    Object.assign(project, patch, { updatedAt: nowIso() })
    atomicWriteJsonSync(projectFilePath(projectId), project)
    this.persistIndex()
    this.emit()
    return project
  }

  deleteProject(projectId: string): boolean {
    this.load()
    const at = this.index!.projects.findIndex((p) => p.id === projectId)
    if (at < 0) return false
    for (const pageId of this.index!.projectPages[projectId] ?? []) {
      delete this.index!.pages[pageId]
      if (this.activePageId === pageId) this.activePageId = null
    }
    delete this.index!.projectPages[projectId]
    delete this.index!.projectViews[projectId]
    this.index!.projects.splice(at, 1)
    try {
      rmSync(projectDir(projectId), { recursive: true, force: true })
    } catch {
      /* the index is the source of truth; a stale dir is harmless */
    }
    if (!this.activePageId) this.activePageId = this.firstPageId() ?? null
    this.persistIndex()
    this.emit()
    return true
  }

  private firstPageId(): string | null {
    for (const project of this.index!.projects) {
      const first = this.index!.projectPages[project.id]?.[0]
      if (first) return first
    }
    return null
  }

  /* --------------------------------- pages ------------------------------ */

  createPage(projectId: string, init: { title?: string; markdown?: boolean; viewId?: string } = {}): PagePayload | null {
    this.load()
    if (!this.index!.projects.some((p) => p.id === projectId)) return null
    const now = nowIso()
    const pageId = newId('page')

    let view: ViewDoc
    let newRecords: ContentRecord[]
    if (init.viewId) {
      const sourceProjectId = this.projectIdForView(init.viewId)
      const source = sourceProjectId ? this.getView(sourceProjectId, init.viewId) : null
      if (!source || !sourceProjectId) return null
      const cloned = cloneViewInstance(source, (recordId) => this.getRecord(sourceProjectId, recordId), now)
      view = cloned.view
      newRecords = cloned.records
    } else {
      view = withRevision(barebonesView(init.title ?? 'Notes'), 0)
      const record: ContentRecord = {
        id: newId('record'),
        kind: 'richtext',
        label: init.title ?? 'Notes',
        doc: emptyDoc(),
        createdAt: now,
        updatedAt: now
      }
      newRecords = [withRevision(record, 0)]
      const richNode = view.root.children?.[0]
      if (richNode) richNode.bind = { recordId: record.id }
    }

    const recordIds = collectViewRecordIds(view)
    const page: PageMeta = {
      id: pageId,
      projectId,
      title: init.title ?? 'Untitled',
      icon: 'file-line',
      viewId: view.id,
      recordIds,
      markdown: init.markdown ?? this.settings.get().editor.markdown,
      createdAt: now,
      updatedAt: now
    }

    const records = { ...this.allRecords(projectId), ...Object.fromEntries(newRecords.map((record) => [record.id, record])) }
    for (const record of newRecords) assertValidRecord(record)
    assertValidView(view, records)
    const nextIndex = structuredClone(this.index!)
    nextIndex.pages[pageId] = page
    ;(nextIndex.projectPages[projectId] ??= []).push(pageId)
    ;(nextIndex.projectViews[projectId] ??= []).push(view.id)
    nextIndex.updatedAt = now
    commitFileTransaction(workspaceRoot(), `Create page ${pageId}`, [
      ...newRecords.map((record): FileMutation => ({ path: recordPath(projectId, record.id), contents: jsonContents(record) })),
      { path: viewPath(projectId, view.id), contents: jsonContents(view) },
      { path: pagePath(projectId, pageId), contents: jsonContents(page) },
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    this.viewCache.set(view.id, view)
    for (const record of newRecords) this.recordCache.set(record.id, record)
    this.activePageId = pageId
    this.persistIndex()
    this.emit()
    return this.pagePayload(pageId)
  }

  updatePage(pageId: string, patch: Partial<Pick<PageMeta, 'title' | 'icon' | 'markdown' | 'trashed'>>): PageMeta | null {
    this.load()
    const page = this.index!.pages[pageId]
    if (!page) return null
    Object.assign(page, patch, { updatedAt: nowIso() })
    atomicWriteJsonSync(pagePath(page.projectId, pageId), page)
    this.persistIndex()
    this.emit()
    return page
  }

  deletePage(pageId: string, hard = false): boolean {
    this.load()
    const page = this.index!.pages[pageId]
    if (!page) return false
    if (!hard) {
      page.trashed = true
      page.updatedAt = nowIso()
      atomicWriteJsonSync(pagePath(page.projectId, pageId), page)
      if (this.activePageId === pageId) this.activePageId = this.firstPageId()
      this.persistIndex()
      this.emit()
      return true
    }
    const nextIndex = structuredClone(this.index!)
    delete nextIndex.pages[pageId]
    const list = nextIndex.projectPages[page.projectId] ?? []
    const at = list.indexOf(pageId)
    if (at >= 0) list.splice(at, 1)
    const remainingPages = Object.values(nextIndex.pages).filter((candidate) => candidate.projectId === page.projectId)
    const referencedRecords = new Set<string>()
    for (const candidate of remainingPages) {
      for (const recordId of candidate.recordIds) referencedRecords.add(recordId)
      const candidateView = this.getView(candidate.projectId, candidate.viewId)
      if (candidateView) for (const recordId of collectViewRecordIds(candidateView)) referencedRecords.add(recordId)
    }
    const deletingRecords = new Set(page.recordIds)
    const deletingView = !remainingPages.some((candidate) => candidate.viewId === page.viewId)
    const durableViews = this.durableViews(page.projectId)
    const oldView = durableViews.find((view) => view.id === page.viewId)
    if (!oldView) throw new Error(`Cannot safely delete page ${pageId} because its View ${page.viewId} is missing`)
    for (const recordId of collectViewRecordIds(oldView)) deletingRecords.add(recordId)
    for (const project of this.index!.projects) {
      const projectViews = project.id === page.projectId ? durableViews : this.durableViews(project.id)
      for (const durableView of projectViews) {
        if (project.id === page.projectId && deletingView && durableView.id === page.viewId) continue
        for (const recordId of collectViewRecordIds(durableView)) referencedRecords.add(recordId)
      }
    }
    for (const recordId of referencedRecords) deletingRecords.delete(recordId)
    if (deletingView) {
      const views = nextIndex.projectViews[page.projectId] ?? []
      const viewAt = views.indexOf(page.viewId)
      if (viewAt >= 0) views.splice(viewAt, 1)
    }
    nextIndex.updatedAt = nowIso()
    commitFileTransaction(workspaceRoot(), `Delete page ${pageId}`, [
      ...[...deletingRecords].map((recordId): FileMutation => ({ path: recordPath(page.projectId, recordId), delete: true })),
      ...(deletingView ? [{ path: viewPath(page.projectId, page.viewId), delete: true } as FileMutation] : []),
      { path: pagePath(page.projectId, pageId), delete: true },
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    for (const recordId of deletingRecords) this.recordCache.delete(recordId)
    if (deletingView) this.viewCache.delete(page.viewId)
    if (this.activePageId === pageId) this.activePageId = this.firstPageId()
    this.emit()
    return true
  }

  movePage(projectId: string, pageId: string, index: number): void {
    this.load()
    const list = this.index!.projectPages[projectId]
    if (!list) return
    const at = list.indexOf(pageId)
    if (at < 0) return
    list.splice(at, 1)
    list.splice(Math.max(0, Math.min(list.length, index)), 0, pageId)
    this.persistIndex()
    this.emit()
  }

  openPage(pageId: string): PagePayload | null {
    this.load()
    if (!this.index!.pages[pageId]) return null
    this.activePageId = pageId
    this.emit()
    return this.pagePayload(pageId)
  }

  pagePayload(pageId: string): PagePayload | null {
    this.load()
    const page = this.index!.pages[pageId]
    if (!page) return null
    const view = this.getView(page.projectId, page.viewId)
    if (!view) return null
    const records: Record<string, ContentRecord> = {}
    for (const recordId of page.recordIds) {
      const record = this.getRecord(page.projectId, recordId)
      if (record) records[recordId] = record
    }
    const orphaned = Object.values(records).filter((r) => r.orphaned)
    return { page, view, records, orphaned }
  }

  /* --------------------------------- views ------------------------------ */

  /**
   * Always read from disk. The View file is tiny, and caching here used to
   * serve a pre-assistant version of the tree after an AI redesign. Local file
   * reads are cheap; correctness wins.
   */
  getView(projectId: string, viewId: string): ViewDoc | null {
    const raw = readJsonSync<unknown>(viewPath(projectId, viewId))
    if (!raw) return null
    const validation = validateViewDoc(raw)
    if (!validation.valid) return null
    const view = raw as ViewDoc
    this.viewCache.set(viewId, view)
    return view
  }

  private getViewAnywhere(viewId: string): ViewDoc | null {
    this.load()
    for (const project of this.index!.projects) {
      const view = this.getView(project.id, viewId)
      if (view) return view
    }
    return null
  }

  listViews(projectId: string): ViewDoc[] {
    this.load()
    return (this.index!.projectViews[projectId] ?? [])
      .map((id) => this.getView(projectId, id))
      .filter((v): v is ViewDoc => Boolean(v))
  }

  private durableViews(projectId: string): ViewDoc[] {
    this.load()
    const ids = new Set(this.index!.projectViews[projectId] ?? [])
    if (existsSync(projectViewsDir(projectId))) for (const entry of readdirSync(projectViewsDir(projectId))) {
      const id = entry.endsWith('.view.json') ? entry.slice(0, -'.view.json'.length) : ''
      if (isId(id, 'view')) ids.add(id)
    }
    const views: ViewDoc[] = []
    for (const id of ids) {
      const view = this.getView(projectId, id)
      if (!view) throw new Error(`Cannot safely delete content while View ${id} is unreadable or invalid`)
      views.push(view)
    }
    return views
  }

  writeView(projectId: string, view: ViewDoc): void {
    const stored = readJsonSync<ViewDoc>(viewPath(projectId, view.id))
    const next = stored && revisionOf(view) <= revisionOf(stored) ? withRevision(view, revisionOf(stored) + 1) : view
    assertValidView(next, this.allRecords(projectId))
    this.viewCache.set(next.id, next)
    atomicWriteJsonSync(viewPath(projectId, next.id), next)
  }

  saveView(projectId: string, view: ViewDoc, expectedRevision?: number): ViewDoc {
    this.load()
    const existing = this.getView(projectId, view.id)
    const actual = existing ? revisionOf(existing) : 0
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError('view', view.id, expectedRevision, actual)
    const next = withRevision(structuredClone(view), existing ? actual + 1 : revisionOf(view))
    next.updatedAt = nowIso()
    assertValidView(next, this.allRecords(projectId))
    const nextIndex = structuredClone(this.index!)
    const list = (nextIndex.projectViews[projectId] ??= [])
    if (!list.includes(next.id)) list.push(next.id)
    nextIndex.updatedAt = nowIso()
    commitFileTransaction(workspaceRoot(), `Save View ${next.id}`, [
      { path: viewPath(projectId, next.id), contents: jsonContents(next) },
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    this.viewCache.set(next.id, next)
    this.emit()
    return next
  }

  applyViewOps(projectId: string, viewId: string, ops: ViewOp[], summary?: string, expectedRevision?: number): ApplyResult | null {
    this.load()
    const view = this.getView(projectId, viewId)
    if (!view) return null
    const actual = revisionOf(view)
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError('view', viewId, expectedRevision, actual)
    const result = applyViewOps(view, ops, { summary })
    if (result.receipt.applied === 0) return result
    result.view = withRevision(result.view, actual + 1)
    assertValidView(result.view, this.allRecords(projectId))
    const nextIndex = structuredClone(this.index!)
    const changedPages: PageMeta[] = []
    for (const page of Object.values(nextIndex.pages)) {
      if (page.projectId === projectId && page.viewId === viewId) {
        page.recordIds = collectViewRecordIds(result.view, page.recordIds)
        page.updatedAt = nowIso()
        changedPages.push(page)
      }
    }
    const reconcile = this.planRecordReconciliation(projectId, viewId, result.view, nextIndex)
    result.receipt.orphanedRecords = reconcile.orphaned
    nextIndex.updatedAt = nowIso()
    commitFileTransaction(workspaceRoot(), `Apply View operations to ${viewId}`, [
      { path: viewPath(projectId, viewId), contents: jsonContents(result.view) },
      ...changedPages.map((page): FileMutation => ({ path: pagePath(projectId, page.id), contents: jsonContents(page) })),
      ...reconcile.records.map((record): FileMutation => ({ path: recordPath(projectId, record.id), contents: jsonContents(record) })),
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    this.viewCache.set(viewId, result.view)
    for (const record of reconcile.records) this.recordCache.set(record.id, record)
    this.emit()
    return result
  }

  /** Publish a complete UI redesign plan without exposing half-created records. */
  applyViewPlan(
    projectId: string,
    viewId: string,
    newRecords: ContentRecord[],
    ops: ViewOp[],
    summary?: string,
    expectedRevision?: number
  ): ApplyResult | null {
    this.load()
    const view = this.getView(projectId, viewId)
    if (!view) return null
    const actual = revisionOf(view)
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError('view', viewId, expectedRevision, actual)
    if (!Array.isArray(newRecords)) throw new Error('View plan records must be an array')

    const existingRecords = this.allRecords(projectId)
    const stagedRecords: ContentRecord[] = []
    const stagedIds = new Set<string>()
    for (const input of newRecords) {
      if (!input || typeof input !== 'object') throw new Error('View plan contains an invalid record')
      if (existingRecords[input.id]) throw new Error(`View plan cannot replace existing record ${input.id}`)
      if (stagedIds.has(input.id)) throw new Error(`View plan contains duplicate record ${input.id}`)
      if (revisionOf(input) !== 0) throw new Error(`New record ${input.id} must start at revision 0`)
      const record = withRevision({ ...structuredClone(input), orphaned: false, orphanedAt: undefined }, 0)
      assertValidRecord(record)
      stagedIds.add(record.id)
      stagedRecords.push(record)
    }

    const result = applyViewOps(view, ops, { summary })
    if (result.receipt.skipped.length) {
      throw new Error(`View plan contains invalid operations: ${result.receipt.skipped.map((item) => `${item.op}: ${item.reason}`).join('; ')}`)
    }
    if (result.receipt.applied === 0 && stagedRecords.length === 0) return result
    result.view = withRevision(result.view, actual + 1)
    const recordsForValidation = { ...existingRecords, ...Object.fromEntries(stagedRecords.map((record) => [record.id, record])) }
    assertValidView(result.view, recordsForValidation)
    const boundIds = new Set(collectViewRecordIds(result.view))
    const unbound = stagedRecords.find((record) => !boundIds.has(record.id))
    if (unbound) throw new Error(`View plan record ${unbound.id} is not bound by the resulting View`)

    const nextIndex = structuredClone(this.index!)
    const changedPages: PageMeta[] = []
    for (const page of Object.values(nextIndex.pages)) {
      if (page.projectId === projectId && page.viewId === viewId) {
        page.recordIds = collectViewRecordIds(result.view, page.recordIds)
        page.updatedAt = nowIso()
        changedPages.push(page)
      }
    }
    const reconcile = this.planRecordReconciliation(projectId, viewId, result.view, nextIndex)
    result.receipt.createdRecords = stagedRecords.map((record) => record.id)
    result.receipt.orphanedRecords = reconcile.orphaned
    nextIndex.updatedAt = nowIso()
    commitFileTransaction(workspaceRoot(), `Apply View plan to ${viewId}`, [
      ...stagedRecords.map((record): FileMutation => ({ path: recordPath(projectId, record.id), contents: jsonContents(record) })),
      { path: viewPath(projectId, viewId), contents: jsonContents(result.view) },
      ...changedPages.map((page): FileMutation => ({ path: pagePath(projectId, page.id), contents: jsonContents(page) })),
      ...reconcile.records.map((record): FileMutation => ({ path: recordPath(projectId, record.id), contents: jsonContents(record) })),
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    this.viewCache.set(viewId, result.view)
    for (const record of stagedRecords) this.recordCache.set(record.id, record)
    for (const record of reconcile.records) this.recordCache.set(record.id, record)
    this.emit()
    return result
  }

  duplicateView(projectId: string, viewId: string, name?: string): ViewDoc | null {
    const view = this.getView(projectId, viewId)
    if (!view) return null
    const copy: ViewDoc = withRevision({ ...structuredClone(view), id: newId('view'), name: name ?? `${view.name} copy`, createdAt: nowIso(), updatedAt: nowIso() }, 0)
    return this.saveView(projectId, copy)
  }

  removeView(projectId: string, viewId: string): void {
    this.load()
    if (Object.values(this.index!.pages).some((page) => page.projectId === projectId && page.viewId === viewId)) {
      throw new Error(`Cannot remove View ${viewId} while a page uses it`)
    }
    const nextIndex = structuredClone(this.index!)
    const list = nextIndex.projectViews[projectId] ?? []
    const at = list.indexOf(viewId)
    if (at >= 0) list.splice(at, 1)
    nextIndex.updatedAt = nowIso()
    commitFileTransaction(workspaceRoot(), `Remove View ${viewId}`, [
      { path: viewPath(projectId, viewId), delete: true },
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    this.viewCache.delete(viewId)
    this.emit()
  }

  /* -------------------------------- records ----------------------------- */

  /** Always read from disk — see getView. */
  getRecord(projectId: string, recordId: string): ContentRecord | null {
    const raw = readJsonSync<ContentRecord>(recordPath(projectId, recordId))
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null
    this.recordCache.set(recordId, raw)
    return raw
  }

  allRecords(projectId: string): Record<string, ContentRecord> {
    const dir = projectRecordsDir(projectId)
    if (!existsSync(dir)) return {}
    const out: Record<string, ContentRecord> = {}
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.rec.json')) continue
      const id = entry.replace(/\.rec\.json$/, '')
      const record = this.getRecord(projectId, id)
      if (record) out[id] = record
    }
    return out
  }

  writeRecord(projectId: string, record: ContentRecord): ContentRecord {
    const stored = readJsonSync<ContentRecord>(recordPath(projectId, record.id))
    const versioned = stored && revisionOf(record) <= revisionOf(stored) ? withRevision(record, revisionOf(stored) + 1) : record
    const next = { ...versioned, updatedAt: nowIso() } as ContentRecord
    assertValidRecord(next)
    this.recordCache.set(next.id, next)
    atomicWriteJsonSync(recordPath(projectId, next.id), next)
    return next
  }

  /**
   * Record edits are deliberately silent.
   *
   * The renderer that issued the write already holds the new content, and
   * broadcasting a workspace change here made every keystroke in the editor
   * re-render the page — which stole focus mid-sentence. Structural changes
   * (view ops, page/project mutations) still broadcast, and the assistant's
   * turns refresh the page explicitly.
   */
  updateRecord(projectId: string, recordId: string, patch: Partial<ContentRecord>, expectedRevision?: number): ContentRecord | null {
    const existing = this.getRecord(projectId, recordId)
    if (!existing) return null
    const actual = revisionOf(existing)
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError('record', recordId, expectedRevision, actual)
    const immutable = patch as Partial<ContentRecord> & { id?: unknown; kind?: unknown; createdAt?: unknown; revision?: unknown; schemaVersion?: unknown }
    if ((immutable.id !== undefined && immutable.id !== existing.id) || (immutable.kind !== undefined && immutable.kind !== existing.kind) || (immutable.createdAt !== undefined && immutable.createdAt !== existing.createdAt) || (immutable.revision !== undefined && immutable.revision !== actual) || (immutable.schemaVersion !== undefined && immutable.schemaVersion !== ((existing as Revisioned).schemaVersion ?? 1))) {
      throw new Error(`Record patch cannot change identity, kind, creation time, revision or schema version`)
    }
    const next = withRevision({ ...existing, ...patch, id: existing.id, kind: existing.kind, createdAt: existing.createdAt, schemaVersion: (existing as Revisioned).schemaVersion ?? 1, updatedAt: nowIso() } as ContentRecord, actual + 1)
    assertValidRecord(next)
    return this.writeRecord(projectId, next)
  }

  /** Rename one schema field while converting every name-based View reference to its stable field id. */
  renameRecordField(
    projectId: string,
    recordId: string,
    fieldId: string,
    name: string,
    expectedRevision?: number
  ): ContentRecord | null {
    this.load()
    const existing = this.getRecord(projectId, recordId)
    if (!existing) return null
    if (existing.kind !== 'table' && existing.kind !== 'fields') throw new Error('Field rename requires a table or fields record')
    const actual = revisionOf(existing)
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError('record', recordId, expectedRevision, actual)
    const nextName = name.trim()
    if (!nextName) throw new Error('Field name cannot be empty')
    const fields = existing.kind === 'table' ? existing.columns : existing.fields
    const field = fields.find((candidate) => candidate.id === fieldId)
    if (!field) throw new Error(`Field ${fieldId} does not exist`)
    if (fields.some((candidate) => candidate.id !== fieldId && candidate.name === nextName)) throw new Error(`A field named ${nextName} already exists`)
    if (field.name === nextName) return existing

    const renamed = structuredClone(existing)
    const renamedFields = renamed.kind === 'table' ? renamed.columns : renamed.fields
    renamedFields.find((candidate) => candidate.id === fieldId)!.name = nextName
    const nextRecord = withRevision({ ...renamed, updatedAt: nowIso() }, actual + 1)
    assertValidRecord(nextRecord)

    const resolveField = (value: string): string => fields.find((candidate) => candidate.id === value || candidate.name === value)?.id ?? value
    const referenceKeys = new Set(['groupBy', 'titleField', 'labelField', 'valueField', 'dateField', 'imageField', 'captionField'])
    const viewIds = new Set(this.index!.projectViews[projectId] ?? [])
    if (existsSync(projectViewsDir(projectId))) for (const entry of readdirSync(projectViewsDir(projectId))) {
      const id = entry.endsWith('.view.json') ? entry.slice(0, -'.view.json'.length) : ''
      if (isId(id, 'view')) viewIds.add(id)
    }
    const nextRecords = { ...this.allRecords(projectId), [recordId]: nextRecord }
    const changedViews: ViewDoc[] = []
    for (const viewId of viewIds) {
      const current = this.getView(projectId, viewId)
      if (!current) throw new Error(`Cannot safely rename the field while View ${viewId} is unreadable or invalid`)
      const next = structuredClone(current)
      let changed = false
      const visit = (node: ViewDoc['root']) => {
        if (node.bind?.recordId === recordId) {
          if (node.bind.field) {
            const resolved = resolveField(node.bind.field)
            if (resolved !== node.bind.field) { node.bind.field = resolved; changed = true }
          }
          if (node.props) for (const [key, value] of Object.entries(node.props)) {
            if (referenceKeys.has(key) && typeof value === 'string') {
              const resolved = resolveField(value)
              if (resolved !== value) { node.props[key] = resolved; changed = true }
            } else if (key === 'columns' && Array.isArray(value)) {
              const resolved = value.map((item) => typeof item === 'string' ? resolveField(item) : item)
              if (resolved.some((item, index) => item !== value[index])) { node.props[key] = resolved; changed = true }
            }
          }
        }
        for (const child of node.children ?? []) visit(child)
      }
      visit(next.root)
      if (!changed) continue
      next.updatedAt = nowIso()
      const versioned = withRevision(next, revisionOf(current) + 1)
      assertValidView(versioned, nextRecords)
      changedViews.push(versioned)
    }

    commitFileTransaction(workspaceRoot(), `Rename field ${fieldId}`, [
      { path: recordPath(projectId, recordId), contents: jsonContents(nextRecord) },
      ...changedViews.map((view): FileMutation => ({ path: viewPath(projectId, view.id), contents: jsonContents(view) }))
    ])
    this.recordCache.set(recordId, nextRecord)
    for (const view of changedViews) this.viewCache.set(view.id, view)
    this.emit()
    return nextRecord
  }

  createRecord(projectId: string, record: ContentRecord, pageId?: string | null): ContentRecord {
    if (this.getRecord(projectId, record.id)) throw new Error(`Record ${record.id} already exists`)
    const saved = this.writeRecord(projectId, withRevision(record, revisionOf(record)))
    if (pageId) this.adoptRecord(pageId, saved.id)
    return saved
  }

  /** Make a project record visible to a page even before it is bound into the View. */
  adoptRecord(pageId: string, recordId: string): boolean {
    this.load()
    const current = this.index!.pages[pageId]
    if (!current || !this.getRecord(current.projectId, recordId)) return false
    const view = this.getView(current.projectId, current.viewId)
    if (!view) return false
    const nextIndex = structuredClone(this.index!)
    const page = nextIndex.pages[pageId]
    if (!page.recordIds.includes(recordId)) page.recordIds.push(recordId)
    page.updatedAt = nowIso()
    nextIndex.updatedAt = nowIso()
    const reconcile = this.planRecordReconciliation(page.projectId, page.viewId, view, nextIndex)
    commitFileTransaction(workspaceRoot(), `Adopt record ${recordId}`, [
      { path: pagePath(page.projectId, page.id), contents: jsonContents(page) },
      ...reconcile.records.map((record): FileMutation => ({ path: recordPath(page.projectId, record.id), contents: jsonContents(record) })),
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    for (const record of reconcile.records) this.recordCache.set(record.id, record)
    this.emit()
    return true
  }

  /**
   * Reconcile only records owned by pages using the changed View. Orphan state
   * still considers bindings in every project View, so a deliberately shared
   * record is not falsely orphaned when one page is redesigned.
   */
  private reconcileRecordsForView(
    projectId: string,
    viewId: string,
    changedView: ViewDoc
  ): { orphaned: string[]; revived: string[] } {
    this.load()
    const planned = this.planRecordReconciliation(projectId, viewId, changedView, this.index!)
    if (planned.records.length) {
      commitFileTransaction(workspaceRoot(), `Reconcile records for ${viewId}`, planned.records.map((record): FileMutation => ({
        path: recordPath(projectId, record.id),
        contents: jsonContents(record)
      })))
      for (const record of planned.records) this.recordCache.set(record.id, record)
    }
    return { orphaned: planned.orphaned, revived: planned.revived }
  }

  private planRecordReconciliation(
    projectId: string,
    viewId: string,
    changedView: ViewDoc,
    index: WorkspaceIndex
  ): { orphaned: string[]; revived: string[]; records: ContentRecord[] } {
    const affectedPages = Object.values(index.pages).filter(
      (page) => page.projectId === projectId && page.viewId === viewId
    )
    const candidates = new Set<string>()
    for (const page of affectedPages) {
      for (const id of page.recordIds) candidates.add(id)
      for (const id of collectViewRecordIds(changedView)) candidates.add(id)
    }

    const bound = new Set<string>()
    const seenViews = new Set<string>()
    for (const page of Object.values(index.pages)) {
      if (page.projectId !== projectId || seenViews.has(page.viewId)) continue
      seenViews.add(page.viewId)
      const view = page.viewId === viewId ? changedView : this.getView(projectId, page.viewId)
      if (!view) continue
      for (const binding of collectBindings(view.root)) bound.add(binding.recordId)
    }

    const orphaned: string[] = []
    const revived: string[] = []
    const records: ContentRecord[] = []
    for (const id of candidates) {
      const record = this.getRecord(projectId, id)
      if (!record) continue
      let next: ContentRecord | null = null
      if (bound.has(id)) {
        if (record.orphaned) {
          next = withRevision({ ...structuredClone(record), orphaned: false, orphanedAt: undefined, updatedAt: nowIso() }, revisionOf(record) + 1)
          revived.push(id)
        }
      } else if (!record.orphaned) {
        next = withRevision({ ...structuredClone(record), orphaned: true, orphanedAt: nowIso(), updatedAt: nowIso() }, revisionOf(record) + 1)
        orphaned.push(id)
      }
      if (next) { assertValidRecord(next); records.push(next) }
    }
    return { orphaned, revived, records }
  }

  private validateManagedView(projectId: string, view: ViewDoc): string | null {
    const nodeIds = new Set<string>()
    let error: string | null = null
    const visit = (node: ViewDoc['root']) => {
      if (error) return
      if (!isId(node.id, 'node') || nodeIds.has(node.id)) {
        error = `View nodes require unique stable node ids; invalid id ${node.id}`
        return
      }
      nodeIds.add(node.id)
      const spec = getComponent(node.type)
      if (!spec) {
        error = `Unknown component type ${node.type}`
        return
      }
      if (node.bind) {
        const record = this.getRecord(projectId, node.bind.recordId)
        if (!record) {
          error = `Binding references missing record ${node.bind.recordId}`
          return
        }
        const compatible = spec.bindable === 'block'
          ? record.kind === 'richtext'
          : Array.isArray(spec.bindable) && spec.bindable.includes(record.kind)
        if (!compatible) {
          error = `${node.type} cannot bind a ${record.kind} record`
          return
        }
        if (node.bind.blockIds?.length) {
          if (record.kind !== 'richtext') {
            error = `Only rich-text bindings can select block ids`
            return
          }
          const blocks = new Set(record.doc.blocks.map((block) => block.id))
          const missing = node.bind.blockIds.find((id) => !blocks.has(id))
          if (missing) {
            error = `Binding references missing block ${missing}`
            return
          }
        }
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(view.root)
    return error
  }

  deleteRecord(projectId: string, recordId: string): void {
    this.load()
    for (const project of this.index!.projects) for (const view of this.durableViews(project.id)) {
      if (collectBindings(view.root).some((binding) => binding.recordId === recordId)) {
        throw new Error(`Cannot delete record ${recordId} while View ${view.id} binds it`)
      }
    }
    const nextIndex = structuredClone(this.index!)
    const changedPages: PageMeta[] = []
    for (const page of Object.values(nextIndex.pages)) {
      if (page.projectId !== projectId || !page.recordIds.includes(recordId)) continue
      page.recordIds = page.recordIds.filter((id) => id !== recordId)
      page.updatedAt = nowIso()
      changedPages.push(page)
    }
    nextIndex.updatedAt = nowIso()
    commitFileTransaction(workspaceRoot(), `Delete record ${recordId}`, [
      { path: recordPath(projectId, recordId), delete: true },
      ...changedPages.map((page): FileMutation => ({ path: pagePath(projectId, page.id), contents: jsonContents(page) })),
      { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
    ])
    this.index = nextIndex
    this.recordCache.delete(recordId)
    this.emit()
  }

  /** Re-attach an orphaned record by binding it to a node in the current view. */
  reattach(projectId: string, viewId: string, recordId: string, nodeId: string): ApplyResult | null {
    return this.applyViewOps(projectId, viewId, [{ op: 'setBind', target: nodeId, bind: { recordId } }], 'Reattached content')
  }

  workspaceRelativePagePath(projectId: string, pageId: string): string {
    return toWorkspaceRelative(pagePath(projectId, pageId))
  }

  workspaceRelativeViewPath(projectId: string, viewId: string): string {
    return toWorkspaceRelative(viewPath(projectId, viewId))
  }

  workspaceRelativeRecordPath(projectId: string, recordId: string): string {
    return toWorkspaceRelative(recordPath(projectId, recordId))
  }

  /** Filesystem-visible summary used by the assistant's file tools. */
  describeFile(relPath: string): {
    kind: 'view' | 'record' | 'page' | 'project' | 'index' | 'unknown'
    ids: string[]
    projectId?: string
  } {
    this.load()
    const normalized = relPath.replace(/\\/g, '/')
    if (normalized === 'workspace.json') return { kind: 'index', ids: [] }
    const viewMatch = normalized.match(/^projects\/(prj_[^/]+)\/views\/(vw_[^.]+)\.view\.json$/)
    if (viewMatch && isId(viewMatch[1], 'project') && isId(viewMatch[2], 'view')) return { kind: 'view', ids: [viewMatch[2]], projectId: viewMatch[1] }
    const recMatch = normalized.match(/^projects\/(prj_[^/]+)\/records\/(rec_[^.]+)\.rec\.json$/)
    if (recMatch && isId(recMatch[1], 'project') && isId(recMatch[2], 'record')) return { kind: 'record', ids: [recMatch[2]], projectId: recMatch[1] }
    const pageMatch = normalized.match(/^projects\/(prj_[^/]+)\/pages\/(pg_[^.]+)\.page\.json$/)
    if (pageMatch && isId(pageMatch[1], 'project') && isId(pageMatch[2], 'page')) return { kind: 'page', ids: [pageMatch[2]], projectId: pageMatch[1] }
    const projectMatch = normalized.match(/^projects\/(prj_[^/]+)\/project\.json$/)
    if (projectMatch && isId(projectMatch[1], 'project')) return { kind: 'project', ids: [projectMatch[1]], projectId: projectMatch[1] }
    return { kind: 'unknown', ids: [] }
  }

  /**
   * Validate and ingest writes to Rasuko-managed JSON. Returns null for ordinary
   * user files, allowing the generic file tool to write those atomically.
   */
  writeManagedFile(relPath: string, content: string, currentPageId: string | null): ManagedWriteResult | null {
    this.load()
    const normalizedPath = relPath.replace(/\\/g, '/')
    const described = this.describeFile(normalizedPath)
    const managedCandidate =
      normalizedPath === 'workspace.json' ||
      /^projects\/[^/]+\/(project\.json|(?:pages|views|records)\/[^/]+\.(?:page|view|rec)\.json)$/.test(normalizedPath)
    if (described.kind === 'unknown') {
      return managedCandidate
        ? { content: `Refusing invalid managed path: ${normalizedPath}`, isError: true }
        : null
    }

    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch (error) {
      return { content: `Invalid JSON; existing file was not changed: ${error instanceof Error ? error.message : 'parse failed'}`, isError: true }
    }

    const projectId = described.projectId
    if (projectId && !this.index!.projects.some((project) => project.id === projectId)) {
      return { content: `Unknown project ${projectId}; existing files were not changed.`, isError: true }
    }

    try {
      switch (described.kind) {
        case 'record': {
          const recordId = described.ids[0]
          const suppliedRevision = objectValue(raw)?.revision
          const existing = this.getRecord(projectId!, recordId)
          if (suppliedRevision !== undefined && (!Number.isSafeInteger(suppliedRevision) || suppliedRevision !== revisionOf(existing ?? {}))) {
            return { content: `Stale record ${recordId}; expected current revision ${existing ? revisionOf(existing) : 0}. Existing file was not changed.`, isError: true }
          }
          const normalized = normalizeManagedRecord(raw, recordId)
          if (!normalized.ok) return { content: normalized.reason, isError: true }
          ;(normalized.value as Revisioned).revision = existing ? revisionOf(existing) : 0
          ;(normalized.value as Revisioned).schemaVersion = 1
          this.writeRecord(projectId!, normalized.value)
          const current = currentPageId ? this.index!.pages[currentPageId] : null
          if (current && current.projectId === projectId) this.adoptRecord(current.id, recordId)
          this.emit()
          return { content: `Validated and wrote ${normalizedPath}.`, details: { path: normalizedPath, kind: 'record', recordId } }
        }
        case 'view': {
          const viewId = described.ids[0]
          const input = raw as Partial<ViewDoc>
          if (!input || input.id !== viewId) return { content: `View id must match ${viewId}; existing file was not changed.`, isError: true }
          const existing = this.getView(projectId!, viewId)
          const suppliedRevision = (raw as Revisioned).revision
          if (suppliedRevision !== undefined && (!Number.isSafeInteger(suppliedRevision) || suppliedRevision !== revisionOf(existing ?? {}))) {
            return { content: `Stale View ${viewId}; expected current revision ${existing ? revisionOf(existing) : 0}. Existing file was not changed.`, isError: true }
          }
          const rawValidation = validateViewDoc(raw, this.allRecords(projectId!))
          if (!rawValidation.valid) return { content: `Invalid View; existing file was not changed:\n${rawValidation.errors.join('\n')}`, isError: true }
          const coerced = coerceView(raw)
          if (coerced.warnings.length > 0) {
            return { content: `Invalid View; existing file was not changed:\n${coerced.warnings.join('\n')}`, isError: true }
          }
          const validationError = this.validateManagedView(projectId!, coerced.view)
          if (validationError) return { content: `${validationError}; existing file was not changed.`, isError: true }
          const nextView = withRevision(coerced.view, existing ? revisionOf(existing) + 1 : 0)
          ;(nextView as Revisioned).schemaVersion = 1
          assertValidView(nextView, this.allRecords(projectId!))
          const nextIndex = structuredClone(this.index!)
          const views = (nextIndex.projectViews[projectId!] ??= [])
          if (!views.includes(viewId)) views.push(viewId)
          const changedPages: PageMeta[] = []
          for (const page of Object.values(nextIndex.pages)) {
            if (page.projectId === projectId && page.viewId === viewId) {
              page.recordIds = collectViewRecordIds(nextView, page.recordIds)
              page.updatedAt = nowIso()
              changedPages.push(page)
            }
          }
          const reconcile = this.planRecordReconciliation(projectId!, viewId, nextView, nextIndex)
          nextIndex.updatedAt = nowIso()
          commitFileTransaction(workspaceRoot(), `Write managed View ${viewId}`, [
            { path: viewPath(projectId!, viewId), contents: jsonContents(nextView) },
            ...changedPages.map((page): FileMutation => ({ path: pagePath(projectId!, page.id), contents: jsonContents(page) })),
            ...reconcile.records.map((record): FileMutation => ({ path: recordPath(projectId!, record.id), contents: jsonContents(record) })),
            { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
          ])
          this.index = nextIndex
          this.viewCache.set(viewId, nextView)
          for (const record of reconcile.records) this.recordCache.set(record.id, record)
          this.emit()
          return { content: `Validated and wrote ${normalizedPath}.`, details: { path: normalizedPath, kind: 'view', viewId } }
        }
        case 'page': {
          const pageId = described.ids[0]
          const normalized = normalizeManagedPage(raw, pageId, projectId!)
          if (!normalized.ok) return { content: normalized.reason, isError: true }
          const previousPage = this.index!.pages[pageId]
          if (previousPage) {
            // A file-authored View switch must not silently discard ownership of
            // records from the prior View. Keep them as page-owned unplaced
            // content so reconciliation can surface them for reattachment.
            normalized.value.recordIds = [...new Set([...previousPage.recordIds, ...normalized.value.recordIds])]
          }
          if (!this.getView(projectId!, normalized.value.viewId)) return { content: `Unknown view ${normalized.value.viewId}; existing file was not changed.`, isError: true }
          for (const recordId of normalized.value.recordIds) {
            if (!this.getRecord(projectId!, recordId)) return { content: `Unknown record ${recordId}; existing file was not changed.`, isError: true }
          }
          const nextIndex = structuredClone(this.index!)
          nextIndex.pages[pageId] = normalized.value
          const pages = (nextIndex.projectPages[projectId!] ??= [])
          if (!pages.includes(pageId)) pages.push(pageId)
          const views = (nextIndex.projectViews[projectId!] ??= [])
          if (!views.includes(normalized.value.viewId)) views.push(normalized.value.viewId)
          const view = this.getView(projectId!, normalized.value.viewId)!
          const reconcile = this.planRecordReconciliation(projectId!, view.id, view, nextIndex)
          nextIndex.updatedAt = nowIso()
          commitFileTransaction(workspaceRoot(), `Write managed page ${pageId}`, [
            { path: pagePath(projectId!, pageId), contents: jsonContents(normalized.value) },
            ...reconcile.records.map((record): FileMutation => ({ path: recordPath(projectId!, record.id), contents: jsonContents(record) })),
            { path: workspaceIndexPath(), contents: jsonContents(nextIndex) }
          ])
          this.index = nextIndex
          for (const record of reconcile.records) this.recordCache.set(record.id, record)
          this.emit()
          return { content: `Validated and wrote ${normalizedPath}.`, details: { path: normalizedPath, kind: 'page', pageId } }
        }
        case 'project': {
          const normalized = normalizeManagedProject(raw, projectId!)
          if (!normalized.ok) return { content: normalized.reason, isError: true }
          const at = this.index!.projects.findIndex((project) => project.id === projectId)
          this.index!.projects[at] = normalized.value
          atomicWriteJsonSync(projectFilePath(projectId!), normalized.value)
          this.persistIndex()
          this.emit()
          return { content: `Validated and wrote ${normalizedPath}.`, details: { path: normalizedPath, kind: 'project', projectId } }
        }
        case 'index': {
          const normalized = validateManagedIndex(raw)
          if (!normalized.ok) return { content: normalized.reason, isError: true }
          for (const project of normalized.value.projects) {
            if (!existsSync(projectFilePath(project.id))) return { content: `Project file missing for ${project.id}; index was not changed.`, isError: true }
          }
          for (const page of Object.values(normalized.value.pages)) {
            if (!existsSync(pagePath(page.projectId, page.id))) return { content: `Page file missing for ${page.id}; index was not changed.`, isError: true }
            if (!existsSync(viewPath(page.projectId, page.viewId))) return { content: `View file missing for ${page.viewId}; index was not changed.`, isError: true }
          }
          for (const [ownerProjectId, viewIds] of Object.entries(normalized.value.projectViews)) {
            for (const viewId of viewIds) {
              if (!existsSync(viewPath(ownerProjectId, viewId))) return { content: `View file missing for ${viewId}; index was not changed.`, isError: true }
            }
          }
          this.index = normalized.value
          this.persistIndex()
          this.emit()
          return { content: 'Validated and wrote workspace.json.', details: { path: normalizedPath, kind: 'index' } }
        }
        default:
          return null
      }
    } catch (error) {
      return { content: `Managed write failed before completion: ${error instanceof Error ? error.message : 'unknown error'}`, isError: true }
    }
  }

  /** Directories the assistant is allowed to read/write. */
  allowedRoots(): string[] {
    return [workspaceRoot(), settingsPath()]
  }

  projectIdForPage(pageId: string): string | null {
    this.load()
    return this.index!.pages[pageId]?.projectId ?? null
  }

  projectIdForView(viewId: string): string | null {
    this.load()
    for (const project of this.index!.projects) {
      if ((this.index!.projectViews[project.id] ?? []).includes(viewId)) return project.id
      if (existsSync(viewPath(project.id, viewId))) return project.id
    }
    return null
  }

  listProjectFiles(projectId: string): string[] {
    const dir = projectDir(projectId)
    if (!existsSync(dir)) return []
    const out: string[] = []
    const walk = (current: string) => {
      let entries: string[]
      try {
        entries = readdirSync(current)
      } catch {
        return
      }
      for (const entry of entries) {
        const full = join(current, entry)
        let isDir = false
        try {
          isDir = statSync(full).isDirectory()
        } catch {
          continue
        }
        if (isDir) walk(full)
        else out.push(full)
      }
    }
    walk(dir)
    return out
  }
}

function cloneViewInstance(
  source: ViewDoc,
  loadRecord: (id: string) => ContentRecord | null,
  now: string
): { view: ViewDoc; records: ContentRecord[] } {
  const recordMap = new Map<string, string>()
  const nestedMaps = new Map<string, Map<string, string>>()
  const records: ContentRecord[] = []
  for (const sourceId of collectViewRecordIds(source)) {
    const original = loadRecord(sourceId)
    if (!original) throw new Error(`Cannot instantiate View ${source.id}: missing record ${sourceId}`)
    const recordId = newId('record')
    const nested = new Map<string, string>()
    const remap = (id: string) => {
      let mapped = nested.get(id)
      if (!mapped) { mapped = newId('block'); nested.set(id, mapped) }
      return mapped
    }
    let copy = structuredClone(original) as ContentRecord
    if (copy.kind === 'richtext') copy.doc.blocks = copy.doc.blocks.map((block) => ({ ...block, id: remap(block.id) }))
    else if (copy.kind === 'table') {
      copy.columns = copy.columns.map((column) => ({ ...column, id: remap(column.id) }))
      copy.rows = copy.rows.map((row) => ({
        ...row,
        id: remap(row.id),
        cells: Object.fromEntries(Object.entries(row.cells).map(([key, value]) => [nested.get(key) ?? key, value]))
      }))
    } else if (copy.kind === 'list') copy.items = copy.items.map((item) => ({ ...item, id: remap(item.id) }))
    else if (copy.kind === 'fields') {
      copy.fields = copy.fields.map((field) => ({ ...field, id: remap(field.id) }))
      copy.values = Object.fromEntries(Object.entries(copy.values).map(([key, value]) => [nested.get(key) ?? key, value]))
      copy.entries = copy.entries?.map((entry) => ({ ...entry, id: remap(entry.id), values: Object.fromEntries(Object.entries(entry.values).map(([key, value]) => [nested.get(key) ?? key, value])) }))
    }
    copy = withRevision({ ...copy, id: recordId, origin: original.id, createdAt: now, updatedAt: now, orphaned: false, orphanedAt: undefined }, 0)
    recordMap.set(sourceId, recordId)
    nestedMaps.set(sourceId, nested)
    records.push(copy)
  }
  const remapNode = (node: ViewDoc['root']): ViewDoc['root'] => {
    const copy = structuredClone(node)
    copy.id = newId('node')
    if (copy.bind) {
      const sourceRecordId = copy.bind.recordId
      copy.bind.recordId = recordMap.get(sourceRecordId)!
      const nested = nestedMaps.get(sourceRecordId)!
      if (copy.bind.blockIds) copy.bind.blockIds = copy.bind.blockIds.map((id) => nested.get(id) ?? id)
      if (copy.bind.field) copy.bind.field = nested.get(copy.bind.field) ?? copy.bind.field
      if (copy.props) {
        for (const key of ['groupBy', 'titleField', 'labelField', 'valueField', 'dateField', 'imageField', 'captionField']) {
          const value = copy.props[key]
          if (typeof value === 'string' && nested.has(value)) copy.props[key] = nested.get(value)
        }
        if (Array.isArray(copy.props.columns)) copy.props.columns = copy.props.columns.map((value) => typeof value === 'string' ? nested.get(value) ?? value : value)
      }
    }
    if (copy.children) copy.children = copy.children.map(remapNode)
    return copy
  }
  const view = withRevision({ ...structuredClone(source), id: newId('view'), root: remapNode(source.root), createdAt: now, updatedAt: now }, 0)
  assertValidView(view, Object.fromEntries(records.map((record) => [record.id, record])))
  return { view, records }
}

export function collectViewRecordIds(view: ViewDoc, seed: string[] = []): string[] {
  const ids = new Set(seed)
  const walk = (node: { bind?: { recordId: string }; children?: unknown[] }) => {
    if (node.bind?.recordId) ids.add(node.bind.recordId)
    for (const child of (node.children ?? []) as Array<{ bind?: { recordId: string }; children?: unknown[] }>) {
      walk(child)
    }
  }
  walk(view.root as { bind?: { recordId: string }; children?: unknown[] })
  return [...ids]
}

type Validation<T> = { ok: true; value: T } | { ok: false; reason: string }

function invalid<T>(reason: string): Validation<T> {
  return { ok: false, reason: `${reason}; existing file was not changed.` }
}

function objectValue(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function cellValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function normalizeManagedRecord(raw: unknown, expectedId: string): Validation<ContentRecord> {
  const input = objectValue(raw)
  if (!input || input.id !== expectedId || !isId(expectedId, 'record')) return invalid('Record id does not match its filename')
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : nowIso()
  const updatedAt = nowIso()
  const base = {
    id: expectedId,
    label: typeof input.label === 'string' ? input.label : undefined,
    createdAt,
    updatedAt,
    orphaned: typeof input.orphaned === 'boolean' ? input.orphaned : undefined,
    orphanedAt: typeof input.orphanedAt === 'string' ? input.orphanedAt : undefined,
    origin: typeof input.origin === 'string' ? input.origin : undefined,
    tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string') : undefined
  }
  switch (input.kind) {
    case 'richtext': {
      const doc = objectValue(input.doc)
      if (!doc || !Array.isArray(doc.blocks)) return invalid('Rich-text record requires doc.blocks')
      return { ok: true, value: { ...base, kind: 'richtext', doc: normalizeDoc(input.doc as import('@shared/richtext').RichDoc) } }
    }
    case 'table': {
      if (!Array.isArray(input.columns) || !Array.isArray(input.rows)) return invalid('Table record requires columns and rows arrays')
      const usedColumns = new Set<string>()
      const columns: import('@shared/types').TableColumn[] = []
      for (const rawColumn of input.columns) {
        const column = objectValue(rawColumn)
        if (!column || !isId(column.id, 'block') || usedColumns.has(column.id)) return invalid('Table columns require unique stable block ids')
        if (typeof column.name !== 'string' || !['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(String(column.type))) return invalid('Table column schema is invalid')
        usedColumns.add(column.id)
        columns.push({
          id: column.id,
          name: column.name,
          type: column.type as import('@shared/types').TableColumn['type'],
          options: Array.isArray(column.options) ? column.options.map(String) : undefined,
          width: typeof column.width === 'number' && Number.isFinite(column.width) ? column.width : undefined
        })
      }
      const usedRows = new Set<string>()
      const rows: import('@shared/types').TableRecord['rows'] = []
      for (const rawRow of input.rows) {
        const row = objectValue(rawRow)
        const cells = objectValue(row?.cells)
        if (!row || !isId(row.id, 'block') || usedRows.has(row.id) || !cells) return invalid('Table rows require unique stable block ids and cells')
        if (Object.keys(cells).some((key) => !usedColumns.has(key)) || Object.values(cells).some((value) => !cellValue(value))) return invalid('Table cells must use column ids and scalar values')
        usedRows.add(row.id)
        rows.push({ id: row.id, cells: cells as Record<string, import('@shared/types').TableCellValue>, archived: typeof row.archived === 'boolean' ? row.archived : undefined })
      }
      return { ok: true, value: { ...base, kind: 'table', columns, rows } }
    }
    case 'list': {
      if (!Array.isArray(input.items)) return invalid('List record requires an items array')
      const used = new Set<string>()
      const items: import('@shared/types').ListRecord['items'] = []
      for (const rawItem of input.items) {
        const item = objectValue(rawItem)
        if (!item || !isId(item.id, 'block') || used.has(item.id) || typeof item.text !== 'string') return invalid('List items require unique stable ids and text')
        used.add(item.id)
        items.push({ id: item.id, text: item.text, done: Boolean(item.done) })
      }
      return { ok: true, value: { ...base, kind: 'list', items, ordered: Boolean(input.ordered) } }
    }
    case 'metric': {
      const value = Number(input.value)
      if (!Number.isFinite(value)) return invalid('Metric value must be finite')
      const series = Array.isArray(input.series)
        ? input.series.map((point) => objectValue(point)).filter((point): point is Record<string, unknown> => Boolean(point)).map((point) => ({ label: String(point.label ?? ''), value: Number(point.value) })).filter((point) => Number.isFinite(point.value))
        : undefined
      return {
        ok: true,
        value: {
          ...base,
          kind: 'metric',
          value,
          previous: input.previous === undefined ? undefined : Number(input.previous),
          unit: input.unit === undefined ? undefined : String(input.unit),
          format: ['number', 'percent', 'currency'].includes(String(input.format)) ? input.format as 'number' | 'percent' | 'currency' : 'number',
          target: input.target === undefined ? undefined : Number(input.target),
          series
        }
      }
    }
    case 'fields': {
      if (!Array.isArray(input.fields) || !objectValue(input.values)) return invalid('Fields record requires fields and values')
      const usedFields = new Set<string>()
      const fields: import('@shared/types').FieldDef[] = []
      for (const rawField of input.fields) {
        const field = objectValue(rawField)
        if (!field || !isId(field.id, 'block') || usedFields.has(field.id) || typeof field.name !== 'string' || !['text', 'longtext', 'number', 'date', 'select', 'checkbox', 'url'].includes(String(field.type))) return invalid('Field schema requires unique stable ids, names and valid types')
        usedFields.add(field.id)
        fields.push({ id: field.id, name: field.name, type: field.type as import('@shared/types').FieldDef['type'], options: Array.isArray(field.options) ? field.options.map(String) : undefined, required: Boolean(field.required), help: typeof field.help === 'string' ? field.help : undefined })
      }
      const values = objectValue(input.values)!
      if (Object.keys(values).some((key) => !usedFields.has(key)) || Object.values(values).some((value) => !cellValue(value))) return invalid('Field values must use field ids and scalar values')
      const entries: import('@shared/types').FieldsRecord['entries'] = []
      for (const rawEntry of Array.isArray(input.entries) ? input.entries : []) {
        const entry = objectValue(rawEntry)
        const entryValues = objectValue(entry?.values)
        if (!entry || !isId(entry.id, 'block') || !entryValues || typeof entry.createdAt !== 'string') return invalid('Field entry is invalid')
        if (Object.keys(entryValues).some((key) => !usedFields.has(key)) || Object.values(entryValues).some((value) => !cellValue(value))) return invalid('Entry values must use field ids and scalar values')
        entries.push({ id: entry.id, values: entryValues as Record<string, import('@shared/types').TableCellValue>, createdAt: entry.createdAt })
      }
      return { ok: true, value: { ...base, kind: 'fields', fields, values: values as Record<string, import('@shared/types').TableCellValue>, entries } }
    }
    default:
      return invalid('Unsupported record kind')
  }
}

function normalizeManagedPage(raw: unknown, expectedId: string, projectId: string): Validation<PageMeta> {
  const input = objectValue(raw)
  if (!input || input.id !== expectedId || input.projectId !== projectId || !isId(expectedId, 'page')) return invalid('Page identity does not match its path')
  if (typeof input.title !== 'string' || !isId(input.viewId, 'view') || !Array.isArray(input.recordIds) || input.recordIds.some((id) => !isId(id, 'record'))) return invalid('Page metadata is invalid')
  return {
    ok: true,
    value: {
      id: expectedId,
      projectId,
      title: input.title,
      icon: typeof input.icon === 'string' ? input.icon : undefined,
      viewId: input.viewId,
      recordIds: [...new Set(input.recordIds as string[])],
      markdown: Boolean(input.markdown),
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
      updatedAt: nowIso(),
      trashed: typeof input.trashed === 'boolean' ? input.trashed : undefined
    }
  }
}

function normalizeManagedProject(raw: unknown, expectedId: string): Validation<ProjectMeta> {
  const input = objectValue(raw)
  if (!input || input.id !== expectedId || !isId(expectedId, 'project') || typeof input.name !== 'string') return invalid('Project metadata is invalid')
  return {
    ok: true,
    value: {
      id: expectedId,
      name: input.name.trim() || 'Untitled project',
      icon: typeof input.icon === 'string' ? input.icon : undefined,
      color: typeof input.color === 'string' ? input.color : undefined,
      description: typeof input.description === 'string' ? input.description : undefined,
      pinned: typeof input.pinned === 'boolean' ? input.pinned : undefined,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : nowIso(),
      updatedAt: nowIso()
    }
  }
}

function validateManagedIndex(raw: unknown): Validation<WorkspaceIndex> {
  const input = objectValue(raw)
  if (!input || !Array.isArray(input.projects) || !objectValue(input.pages) || !objectValue(input.projectPages) || !objectValue(input.projectViews)) return invalid('Workspace index shape is invalid')
  const projects: ProjectMeta[] = []
  const projectIds = new Set<string>()
  for (const rawProject of input.projects) {
    const projectInput = objectValue(rawProject)
    if (!projectInput || !isId(projectInput.id, 'project') || projectIds.has(projectInput.id)) return invalid('Workspace projects require unique stable ids')
    const project = normalizeManagedProject(projectInput, projectInput.id)
    if (!project.ok) return project
    projectIds.add(projectInput.id)
    projects.push(project.value)
  }
  const pages: Record<string, PageMeta> = {}
  for (const [pageId, rawPage] of Object.entries(input.pages as Record<string, unknown>)) {
    const pageInput = objectValue(rawPage)
    if (!pageInput || !projectIds.has(String(pageInput.projectId))) return invalid(`Page ${pageId} references an unknown project`)
    const page = normalizeManagedPage(pageInput, pageId, String(pageInput.projectId))
    if (!page.ok) return page
    pages[pageId] = page.value
  }
  const projectPages: Record<string, string[]> = {}
  const projectViews: Record<string, string[]> = {}
  for (const projectId of projectIds) {
    const rawPages = (input.projectPages as Record<string, unknown>)[projectId]
    const rawViews = (input.projectViews as Record<string, unknown>)[projectId]
    if (!Array.isArray(rawPages) || rawPages.some((id) => typeof id !== 'string' || pages[id]?.projectId !== projectId)) return invalid(`projectPages is invalid for ${projectId}`)
    if (!Array.isArray(rawViews) || rawViews.some((id) => !isId(id, 'view'))) return invalid(`projectViews is invalid for ${projectId}`)
    projectPages[projectId] = [...new Set(rawPages as string[])]
    projectViews[projectId] = [...new Set(rawViews as string[])]
  }
  for (const page of Object.values(pages)) {
    if (!projectPages[page.projectId]?.includes(page.id)) return invalid(`Page ${page.id} is missing from projectPages`)
    if (!projectViews[page.projectId]?.includes(page.viewId)) return invalid(`View ${page.viewId} is missing from projectViews`)
  }
  return { ok: true, value: { version: WORKSPACE_VERSION, projects, pages, projectPages, projectViews, updatedAt: nowIso() } }
}

function toWorkspaceRelative(path: string): string {
  return relative(workspaceRoot(), path).split(sep).join('/')
}
