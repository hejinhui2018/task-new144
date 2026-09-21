import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { EventStore } from '../engine/store'
import type { World } from '../engine/engine'

const StoreContext = createContext<EventStore | null>(null)

export function StoreProvider({ store, children }: { store: EventStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): EventStore {
  const s = useContext(StoreContext)
  if (!s) throw new Error('StoreProvider 缺失')
  return s
}

/** 订阅 store 版本号并返回归约后的世界状态 */
export function useWorld(): World {
  const store = useStore()
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  )
  return store.getWorld()
}
