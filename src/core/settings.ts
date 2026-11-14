import { useCallback, useState } from 'react'

const PREFIX = 'quill-set:'

/** 带 localStorage 持久化的小设置钩子 */
export function useSetting<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  const set = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(next))
      } catch {
        /* 隐私模式下写不了就算了 */
      }
    },
    [key],
  )

  return [value, set]
}
