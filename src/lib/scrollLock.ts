/**
 * scrollLock.ts
 * Centralised helpers to lock / unlock page scroll for modals, drawers,
 * and share dialogs. Using a reference-count so nested callers don't
 * prematurely unlock.
 *
 * Usage
 * -----
 *   import { lockScroll, unlockScroll } from '../lib/scrollLock'
 *
 *   // lock
 *   lockScroll()
 *   // unlock (in close handler / useEffect cleanup / finally block)
 *   unlockScroll()
 */

let _lockCount = 0

/** Lock page scroll. Safe to call multiple times (reference-counted). */
export function lockScroll(): void {
  _lockCount++
  if (_lockCount === 1) {
    document.body.style.overflow = 'hidden'
  }
}

/**
 * Unlock page scroll. Removes the lock only when all callers have unlocked.
 * Always safe to call even if not currently locked.
 */
export function unlockScroll(): void {
  if (_lockCount > 0) _lockCount--
  if (_lockCount === 0) {
    document.body.style.overflow = ''
  }
}

/** Force-unlock regardless of the reference count (use in safety resets). */
export function forceUnlockScroll(): void {
  _lockCount = 0
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
  document.documentElement.style.position = ''
  document.documentElement.style.height = ''
  document.body.style.position = ''
  document.body.style.height = ''
  document.body.style.touchAction = ''
}

/**
 * Returns true when at least one modal/drawer currently holds the lock.
 * Used by the global safety reset to know whether it's safe to force-unlock.
 */
export function isScrollLocked(): boolean {
  return _lockCount > 0
}

/**
 * Install a global safety net that removes any stray scroll-lock styles
 * whenever the tab regains focus / becomes visible.
 * Call once from main.tsx or App.tsx.
 */
export function installScrollLockSafetyReset(): void {
  const reset = () => {
    // Only force-unlock if nothing in the app is actively locking.
    // This handles the case where WhatsApp / Share sheet stole focus
    // and never gave us a chance to run cleanup.
    if (_lockCount === 0) {
      forceUnlockScroll()
    }
  }

  window.addEventListener('focus', reset, { passive: true })
  window.addEventListener('pageshow', reset, { passive: true })
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') reset()
    },
    { passive: true },
  )
}
