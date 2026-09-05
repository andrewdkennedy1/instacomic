import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Keep one history entry per gesture, held key, or field edit. */
export function useDraftHistory<T>(value: T, restore: (value: T) => void) {
  const initial = useRef(JSON.stringify(value))
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const group = useRef<string | null>(null)
  const [, refresh] = useState(0)

  function change(action: () => void, groupId?: string) {
    if (!groupId || group.current !== groupId) {
      past.current = [...past.current.slice(-79), structuredClone(value)]
    }
    future.current = []
    group.current = groupId ?? null
    action()
    refresh((revision) => revision + 1)
  }

  function travel(backward: boolean) {
    const source = backward ? past : future
    const target = backward ? future : past
    const next = source.current.pop()
    if (next === undefined) return
    target.current.push(structuredClone(value))
    group.current = null
    restore(next)
    refresh((revision) => revision + 1)
  }

  return {
    change,
    endGroup: () => {
      group.current = null
    },
    undo: () => travel(true),
    redo: () => travel(false),
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    dirty: JSON.stringify(value) !== initial.current,
  }
}

/** Trap only visible controls in the active dialog, then restore useful focus. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, fallback?: string) {
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      // Do not steal focus if the user has already reached a dialog control.
      if (!ref.current?.contains(document.activeElement)) {
        ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true })
      }
    })
    function trap(event: KeyboardEvent) {
      const dialog = ref.current
      if (event.key !== 'Tab' || !dialog || dialog.querySelector('[role="alertdialog"]')) return
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0 && !control.closest('[inert]'))
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (
        !dialog.contains(document.activeElement) ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', trap)
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true })
        else if (fallback) document.querySelector<HTMLElement>(fallback)?.focus({ preventScroll: true })
      })
    }
  }, [ref, open, fallback])
}
