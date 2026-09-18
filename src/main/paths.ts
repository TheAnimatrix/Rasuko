import { homedir } from 'node:os'
import { join } from 'node:path'

/** `RASUKO_HOME` override keeps the app usable in tests and from the CLI. */
export function rasukoHome(): string {
  return process.env.RASUKO_HOME ?? join(homedir(), '.rasuko')
}

export function authPath(): string {
  return join(rasukoHome(), 'auth.json')
}

export function settingsPath(): string {
  return join(rasukoHome(), 'rasuko.conf')
}

export function workspaceRoot(): string {
  return join(rasukoHome(), 'workspace')
}

export function workspaceIndexPath(): string {
  return join(workspaceRoot(), 'workspace.json')
}

export function projectDir(projectId: string): string {
  return join(workspaceRoot(), 'projects', projectId)
}

export function projectFilePath(projectId: string): string {
  return join(projectDir(projectId), 'project.json')
}

export function projectPagesDir(projectId: string): string {
  return join(projectDir(projectId), 'pages')
}

export function projectViewsDir(projectId: string): string {
  return join(projectDir(projectId), 'views')
}

export function projectRecordsDir(projectId: string): string {
  return join(projectDir(projectId), 'records')
}

export function pagePath(projectId: string, pageId: string): string {
  return join(projectPagesDir(projectId), `${pageId}.page.json`)
}

export function viewPath(projectId: string, viewId: string): string {
  return join(projectViewsDir(projectId), `${viewId}.view.json`)
}

export function recordPath(projectId: string, recordId: string): string {
  return join(projectRecordsDir(projectId), `${recordId}.rec.json`)
}

export function sharedViewsDir(): string {
  return join(workspaceRoot(), 'shared', 'views')
}
