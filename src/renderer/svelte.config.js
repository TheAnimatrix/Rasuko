// A real config file, not a re-export.
//
// Vite treats `src/renderer` as the root for the renderer build, and the Svelte
// plugin only auto-discovers a config at that root. Re-exporting the project
// config from an ancestor path was not picked up ("no Svelte config found ...
// using default configuration"), which left runes mode and preprocessing to
// auto-detection.
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true
  }
}
