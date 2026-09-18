import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { registerIcons } from '$lib/icons'
import { initTheme } from '$lib/stores/theme.svelte'
import { initSettings } from '$lib/stores/settings.svelte'

registerIcons()

const target = document.getElementById('app')
if (!target) throw new Error('Missing #app mount target')

// Hash routing needs an explicit initial hash. Without one, sv-router matches the
// empty fragment against the deployed file path and lands on the last-defined
// route (`/settings`) instead of `/`.
if (!window.location.hash) {
  window.history.replaceState(null, '', '#/')
}

// Settings and theme must be applied before first paint to avoid a flash.
await initSettings()
initTheme()

mount(App, { target })
