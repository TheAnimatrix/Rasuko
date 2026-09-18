import { createRouter } from 'sv-router'
import Home from './routes/Home.svelte'
import PageRoute from './routes/PageRoute.svelte'
import SettingsRoute from './routes/SettingsRoute.svelte'

/**
 * Hash-based routing: Electron loads the renderer from `file://` in production,
 * so pathname routing would 404 on reload.
 */
export const { p, navigate, isActive, route } = createRouter(
  {
    '/': Home,
    '/page/:pageId': PageRoute,
    '/settings': SettingsRoute
  },
  { base: '#' }
)
