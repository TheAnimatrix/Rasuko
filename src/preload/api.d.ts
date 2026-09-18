import type { RasukoAPI } from '../preload/index'

declare global {
  interface Window {
    rasuko: RasukoAPI
  }
}

export {}
