const pending = new Set<Promise<unknown>>()

export function trackUiWrite<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise)
  void promise.then(() => pending.delete(promise), () => pending.delete(promise))
  return promise
}

async function drain(): Promise<void> {
  await Promise.resolve()
  while (pending.size) await Promise.all([...pending])
}
if (typeof window !== 'undefined') window.addEventListener('rasuko:flush-editors', (event) => {
  ;(event as CustomEvent<{ waitUntil?: (promise: Promise<unknown>) => void }>).detail?.waitUntil?.(drain())
})
