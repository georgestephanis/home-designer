import { useCallback, useState } from "react";

const LIMIT = 200;

interface H<T> { past: T[]; present: T; future: T[] }

/**
 * Undo history. `commit` records a change; `live` replaces the present without recording it
 * (for drags), and `settle(base)` then records the whole drag as one step from `base`.
 */
export function useHistory<T>(initial: () => T) {
  const [h, setH] = useState<H<T>>(() => ({ past: [], present: initial(), future: [] }));
  const commit = useCallback((next: T | ((cur: T) => T)) => setH((s) => {
    const v = typeof next === "function" ? (next as (c: T) => T)(s.present) : next;
    return v === s.present ? s : { past: [...s.past, s.present].slice(-LIMIT), present: v, future: [] };
  }), []);
  const live = useCallback((next: T | ((cur: T) => T)) => setH((s) => {
    const v = typeof next === "function" ? (next as (c: T) => T)(s.present) : next;
    return { ...s, present: v };
  }), []);
  const settle = useCallback((base: T) => setH((s) =>
    s.present === base ? s : { past: [...s.past, base].slice(-LIMIT), present: s.present, future: [] }), []);
  const undo = useCallback(() => setH((s) => s.past.length
    ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s), []);
  const redo = useCallback(() => setH((s) => s.future.length
    ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s), []);
  const reset = useCallback((v: T) => setH({ past: [], present: v, future: [] }), []);
  return { doc: h.present, canUndo: h.past.length > 0, canRedo: h.future.length > 0, commit, live, settle, undo, redo, reset };
}
