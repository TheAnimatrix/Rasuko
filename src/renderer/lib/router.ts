/**
 * Convenience alias so feature components can import navigation from `$lib`
 * without reaching across the renderer root. The router itself lives at
 * `src/renderer/router.ts` and is created with `sv-router` in hash mode.
 */
import { navigate as rawNavigate } from '../router'
import { flushEditors } from './flushEditors'
export { p, isActive, route } from '../router'

export const navigate = (async (...args: Parameters<typeof rawNavigate>) => {
  try { await flushEditors() } catch { return }
  return rawNavigate(...args)
}) as typeof rawNavigate
