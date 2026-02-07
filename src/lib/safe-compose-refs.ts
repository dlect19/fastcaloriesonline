/**
 * React 18-safe replacement for @radix-ui/react-compose-refs v1.1.2.
 *
 * The original v1.1.2 `setRef` returns `ref(value)`, which React 18
 * misinterprets as a state-dispatch cleanup, causing infinite re-renders.
 * This module ensures `setRef` never returns a value.
 */
import * as React from "react";

function setRef<T>(ref: React.Ref<T> | undefined, value: T): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null && ref !== undefined) {
    (ref as React.MutableRefObject<T>).current = value;
  }
}

function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]): (node: T) => void {
  return (node: T) => {
    refs.forEach((ref) => setRef(ref, node));
  };
}

function useComposedRefs<T>(...refs: (React.Ref<T> | undefined)[]): (node: T) => void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useCallback(composeRefs(...refs), refs);
}

export { composeRefs, useComposedRefs };
