import { useEffect, useState } from 'react'

/**
 * Tracks the browser's visual viewport height (falls back to window.innerHeight).
 *
 * iOS Safari does not shrink `100dvh`/`100vh` when the on-screen keyboard opens —
 * it only shrinks the visual viewport. A `position: fixed` element sized with
 * `100dvh` therefore keeps its pre-keyboard height, and anything pinned to its
 * bottom (e.g. a modal's Save button) ends up rendered underneath the keyboard,
 * outside the area the user can scroll to. Sizing that element from this hook's
 * value instead keeps it fully visible above the keyboard.
 */
export function useVisualViewportHeight(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(
    typeof window !== 'undefined' ? window.visualViewport?.height ?? window.innerHeight : undefined
  )

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => setHeight(vv.height)
    update()

    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])

  return height
}
