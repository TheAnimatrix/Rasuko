import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = join(mkdtempSync(join(tmpdir(), 'rasuko-editor-test-')), 'test.mjs')
await build({
  entryPoints: ['src/renderer/lib/editor/blockModel.test.ts'],
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  tsconfig: 'tsconfig.web.json'
})
await import(pathToFileURL(output).href)
