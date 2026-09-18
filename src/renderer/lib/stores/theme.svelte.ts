import { settingsStore } from './settings.svelte'

type Resolved = 'light' | 'dark'

const media = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(theme: string): Resolved {
  if (theme === 'light' || theme === 'dark') return theme
  return media.matches ? 'dark' : 'light'
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0
  ]
}

/** Slightly darkened accent, used for accent-foreground legibility. */
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (channel: number) => Math.round(channel * (1 - amount))
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

function apply(theme: string, accent: string, scale: number): void {
  const root = document.documentElement
  const resolved = resolve(theme)
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  root.style.setProperty('--rasuko-accent', accent)
  root.style.setProperty('--ring', accent)
  root.style.setProperty('--sidebar-ring', accent)
  root.style.setProperty('--accent-foreground', resolved === 'dark' ? accent : darken(accent, 0.45))
  root.style.fontSize = `${Math.round(14 * scale)}px`
}

let stop: (() => void) | null = null

export function initTheme(): void {
  const sync = () => {
    const value = settingsStore.value
    if (!value) return
    apply(value.appearance.theme, value.appearance.accent, value.appearance.fontScale)
  }
  sync()

  // React to settings changes with an effect-like subscription.
  $effect.root(() => {
    $effect(() => {
      const value = settingsStore.value
      if (value) apply(value.appearance.theme, value.appearance.accent, value.appearance.fontScale)
    })
  })

  if (!stop) {
    const listener = () => sync()
    media.addEventListener('change', listener)
    stop = () => media.removeEventListener('change', listener)
  }
}

export function currentTheme(): Resolved {
  return resolve(settingsStore.value?.appearance.theme ?? 'system')
}
