import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'rasuko-interface-ui-')),entry=join(temp,'main.mjs')
await build({entryPoints:['scripts/interface-ui-test.ts'],bundle:true,platform:'node',format:'esm',outfile:entry,tsconfig:'tsconfig.node.json',packages:'external',plugins:[{name:'installed-pi',setup(builder){builder.onResolve({filter:/^@earendil-works\/pi-ai(?:\/.*)?$/},({path})=>({path:import.meta.resolve(path),external:true}))}}]})
const env={...process.env,RASUKO_HOME:join(temp,'home'),RASUKO_TEST_ROOT:root}
delete env.ELECTRON_RUN_AS_NODE
const child=spawn(createRequire(import.meta.url)('electron'),[entry],{env,windowsHide:true,stdio:'inherit'})
const timer=setTimeout(()=>{console.error('Interface acceptance exceeded 100 seconds');child.kill()},100000)
try{process.exitCode=(await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)}))??1}finally{clearTimeout(timer)}
