/**
 * Pointer-driven panel resizing.
 *
 * Uses pointer capture on the handle itself so a drag that ends outside the
 * window (or over another element) still terminates cleanly. Without capture the
 * global pointermove listener keeps firing and the panel appears to "stick" to
 * the cursor, which reads as the app breaking.
 */
export interface ResizeHandle {
  destroy: () => void
}

export function attachResize(options: {
  handle: HTMLElement
  direction: 'left' | 'right'
  get: () => number
  set: (value: number) => void
  min: number
  max: number
}): ResizeHandle {
  const { handle, direction, get, set, min, max } = options
  let startX = 0
  let startValue = 0
  let pointerId: number | null = null

  const clamp = (value: number) => Math.max(min, Math.min(max, value))

  const apply = (event: PointerEvent) => {
    // The pointer was released somewhere we did not observe; treat it as a stop.
    if (event.buttons === 0) {
      stop()
      return
    }
    const delta = direction === 'right' ? event.clientX - startX : startX - event.clientX
    set(clamp(startValue + delta))
  }

  function stop(): void {
    if (pointerId === null) return
    try {
      handle.releasePointerCapture(pointerId)
    } catch {
      /* already released */
    }
    pointerId = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    handle.removeEventListener('pointermove', apply)
    handle.removeEventListener('pointerup', stop)
    handle.removeEventListener('pointercancel', stop)
    handle.removeEventListener('lostpointercapture', stop)
    window.removeEventListener('blur', stop)
  }

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    startX = event.clientX
    startValue = get()
    pointerId = event.pointerId
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      /* capture is best-effort */
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    handle.addEventListener('pointermove', apply)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
    window.addEventListener('blur', stop)
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 16 : -16
    const signed = direction === 'right' ? step : -step
    set(clamp(get() + signed))
  }

  handle.addEventListener('pointerdown', down)
  handle.addEventListener('keydown', keydown)

  return {
    destroy: () => {
      handle.removeEventListener('pointerdown', down)
      handle.removeEventListener('keydown', keydown)
      stop()
    }
  }
}
