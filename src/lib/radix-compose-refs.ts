/**
 * Patched version of @radix-ui/react-compose-refs for React 18 compatibility.
 * 
 * The original 1.1.2 version returns the result of ref(value) to support
 * React 19 cleanup refs. This causes an infinite setState loop in React 18
 * when nested Presence components compose refs (e.g., Dialog with Overlay + Content).
 * 
 * Fix: Don't return the result of ref(value) since React 18 doesn't use cleanup refs.
 * See: https://github.com/radix-ui/primitives/issues/3664
 */
import * as React from "react";

function setRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null && ref !== undefined) {
    (ref as React.MutableRefObject<T>).current = value;
  }
}

function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T) => {
    refs.forEach((ref) => {
      setRef(ref, node);
    });
  };
}

function useComposedRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useCallback(composeRefs(...refs), refs);
}

export { composeRefs, useComposedRefs };
