import { useState, useEffect, useRef } from 'react'

export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

export function useDebouncedValue<T>(value: T, delay: number = 300): [T, (immediateValue?: T) => void] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delay])

  const flush = (immediateValue?: T) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setDebouncedValue(immediateValue !== undefined ? immediateValue : value)
  }

  return [debouncedValue, flush]
}
