/**
 * React 18-compatible replacement for @radix-ui/react-compose-refs v1.1.2.
 *
 * The upstream v1.1.2 introduced cleanup-function tracking (for React 19's
 * ref-cleanup feature). In React 18 this causes an infinite setState loop
 * because `setRef` returns the result of calling a callback ref, which may
 * be a state-setter dispatch – React sees the state update, re-renders, and
 * the composed ref is re-invoked, creating an infinite cycle.
 *
 * This patch strips the cleanup logic and keeps behaviour identical to the
 * pre-1.1.0 version that worked fine with React 18.
 */
import { useCallback } from "react";
import type { Ref, RefCallback } from "react";

/**
 * Set a ref value without returning anything (critical difference from v1.1.2
 * which `return ref(value)` and thus forwards the cleanup/dispatch return).
 */
function setRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (typeof ref === "function") {
    (ref as RefCallback<T>)(value);
  } else if (ref != null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ref as any).current = value;
  }
}

/**
 * Compose multiple refs into one callback ref.  Does **not** return a cleanup
 * function – React 18 ignores ref-callback return values anyway.
 */
function composeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node: T) => {
    refs.forEach((ref) => setRef(ref, node));
  };
}

/**
 * Hook version of `composeRefs`.  Memoised so the returned callback is stable
 * across renders when the input refs don't change identity.
 */
function useComposedRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(composeRefs(...refs), refs);
}

export { composeRefs, useComposedRefs };
