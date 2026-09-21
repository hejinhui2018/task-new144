import { useCallback } from 'react'
import { useStore } from './useStore'
import { useToast } from './toast'
import type { Command, Decision } from '../engine/types'

export function useActions() {
  const store = useStore()
  const toast = useToast()

  const act = useCallback(
    (make: (at: number) => Command, okText?: string): Decision => {
      const d = store.dispatch(make(store.now()))
      if (d.ok) {
        if (okText) toast(okText, 'ok')
      } else {
        toast(d.error ?? '操作被拒绝', 'err')
      }
      return d
    },
    [store, toast],
  )

  return { store, act }
}
