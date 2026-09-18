/**
 * Icons: Iconify `mingcute` only.
 *
 * The collection is registered once against the in-process Iconify store so the
 * app is fully offline (no Iconify API calls from inside Electron).
 */
import { addCollection } from '@iconify/svelte'
import mingcute from '@iconify-json/mingcute/icons.json'

let registered = false

export function registerIcons(): void {
  if (registered) return
  registered = true
  addCollection(mingcute as Parameters<typeof addCollection>[0])
}

/** Fallback used when a prop references an icon name we do not ship. */
export const FALLBACK_ICON = 'mingcute:box-line'

export function iconName(name: string | undefined | null): string {
  if (!name) return FALLBACK_ICON
  return name.includes(':') ? name : `mingcute:${name}`
}
