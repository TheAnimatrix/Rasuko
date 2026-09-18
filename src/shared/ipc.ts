/** Canonical IPC channel names. Kept in one place so preload/main can never drift. */

export const IPC = {
  app: {
    info: 'app:info',
    platform: 'app:platform'
  },
  window: {
    minimize: 'window:minimize',
    maximize: 'window:maximize',
    close: 'window:close',
    flushRequest: 'window:flushRequest',
    flushResult: 'window:flushResult',
    isMaximized: 'window:isMaximized',
    maximizedChanged: 'window:maximized-changed',
    setThemeBackground: 'window:set-theme-background'
  },
  workspace: {
    snapshot: 'workspace:snapshot',
    changed: 'workspace:changed',
    createProject: 'workspace:createProject',
    updateProject: 'workspace:updateProject',
    deleteProject: 'workspace:deleteProject',
    createPage: 'workspace:createPage',
    updatePage: 'workspace:updatePage',
    deletePage: 'workspace:deletePage',
    movePage: 'workspace:movePage',
    openPage: 'workspace:openPage',
    pagePayload: 'workspace:pagePayload'
  },
  records: {
    get: 'records:get',
    update: 'records:update',
    action: 'records:action',
    undoAction: 'records:undoAction',
    renameField: 'records:renameField',
    create: 'records:create',
    list: 'records:list',
    delete: 'records:delete',
    reattach: 'records:reattach'
  },
  view: {
    get: 'view:get',
    list: 'view:list',
    save: 'view:save',
    applyOps: 'view:applyOps',
    create: 'view:create',
    duplicate: 'view:duplicate',
    remove: 'view:remove',
    convertToCustom: 'view:convertToCustom',
    revertToBarebones: 'view:revertToBarebones',
    export: 'view:export',
    install: 'view:install'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    changed: 'settings:changed',
    catalog: 'settings:catalog'
  },
  providers: {
    list: 'providers:list',
    setApiKey: 'providers:setApiKey',
    logout: 'providers:logout',
    loginOAuth: 'providers:loginOAuth',
    loginApiKey: 'providers:loginApiKey',
    respondLogin: 'providers:respondLogin',
    cancelLogin: 'providers:cancelLogin',
    loginEvent: 'providers:login:event',
    changed: 'providers:changed',
    discoverModels: 'providers:discoverModels',
    usage: 'providers:usage'
  },
  chat: {
    send: 'chat:send',
    abort: 'chat:abort',
    current: 'chat:current',
    list: 'chat:list',
    create: 'chat:create',
    select: 'chat:select',
    history: 'chat:history',
    clear: 'chat:clear',
    message: 'chat:message',
    event: 'chat:event'
  }
} as const

export type ChatStreamEvent =
  | { type: 'turn_start'; turnId: string; pageId: string; conversationId: string }
  | { type: 'text_delta'; turnId: string; pageId: string; conversationId: string; delta: string }
  | { type: 'thinking_delta'; turnId: string; pageId: string; conversationId: string; delta: string }
  | { type: 'tool_start'; turnId: string; pageId: string; conversationId: string; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; turnId: string; pageId: string; conversationId: string; id: string; output: string; isError: boolean }
  | { type: 'view_ops'; turnId: string; pageId: string; conversationId: string; receipt: import('./types').OpReceipt }
  | { type: 'notice'; turnId: string; pageId: string; conversationId: string; level: 'info' | 'warning' | 'error'; text: string }
  | { type: 'turn_end'; turnId: string; pageId: string; conversationId: string; message: import('./types').ChatMessage }
  | { type: 'error'; turnId: string; pageId: string; conversationId: string; message: string }
