// Drives a real Electron window resize over CDP so layout regressions are reproducible.
const port = process.argv[2] ?? '9222'
const width = Number(process.argv[3] ?? 640)
const height = Number(process.argv[4] ?? 480)

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page') ?? targets[0]
if (!page) throw new Error('no page target')

const ws = new WebSocket(version.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

function send(method, params = {}, sessionId) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
})

await new Promise((resolve) => ws.addEventListener('open', resolve))

const { targetInfos } = await send('Target.getTargets')
const info = targetInfos.find((t) => t.type === 'page')
const { sessionId } = await send('Target.attachToTarget', { targetId: info.targetId, flatten: true })

async function apply(w, h) {
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 0, mobile: false },
    sessionId
  )
  await new Promise((r) => setTimeout(r, 500))
  const result = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const main = document.querySelector('main')
        const aside = document.querySelectorAll('aside')
        return JSON.stringify({
          inner: window.innerWidth + 'x' + window.innerHeight,
          bodyScrollW: document.body.scrollWidth,
          mainW: Math.round(main?.getBoundingClientRect().width ?? -1),
          mainH: Math.round(main?.getBoundingClientRect().height ?? -1),
          asides: [...aside].map(a => Math.round(a.getBoundingClientRect().width)),
          editorW: Math.round((document.querySelector('[contenteditable]') ?? document.body).getBoundingClientRect().width),
          hOverflow: document.documentElement.scrollWidth > window.innerWidth,
          vOverflow: document.documentElement.scrollHeight > window.innerHeight
        })
      })()`,
      returnByValue: true
    },
    sessionId
  )
  console.log(`${w}x${h} ->`, result.result.value)
}

for (const [w, h] of [
  [width, height],
  [820, 560],
  [1200, 800],
  [640, 480],
  [480, 400]
]) {
  await apply(w, h)
}

await send('Emulation.clearDeviceMetricsOverride', {}, sessionId)
ws.close()
