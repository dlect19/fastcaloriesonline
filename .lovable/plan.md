

## Fix: Permanently Resolve "Maximum update depth exceeded" Error

### Problem
The `@radix-ui/react-compose-refs` package (v1.1.2) contains React 19-specific code that is incompatible with React 18. Its `setRef` function does `return ref(value)`, which in React 18 causes an infinite re-render loop when callback refs return values (interpreted as state dispatches). This crashes the app with a blank screen whenever any Radix UI component (Dialog, Checkbox, Switch, etc.) is rendered -- which is why it breaks when opening the combo creation dialog.

All previous attempts to patch this via Vite/esbuild plugins failed because the esbuild `onLoad` hook returned patched code without a `resolveDir`, causing esbuild to silently fall back to the original buggy code.

### Solution: Two-Layer Fix

We will apply the fix at **two levels** to guarantee it works regardless of build caching:

**Layer 1 -- Direct source file patching**
Overwrite the actual package files in `node_modules/@radix-ui/react-compose-refs/dist/`:
- `index.mjs` (ESM version)
- `index.js` (CJS version)

Both will be rewritten to remove the `return ref(value)` and strip the cleanup-tracking logic, making them React 18-safe.

**Layer 2 -- Fixed esbuild plugin (safety net)**
Update the esbuild plugin in `vite.config.ts` to add the missing `resolveDir` parameter, so that even if `node_modules` gets reinstalled, the build-time patch will work as a fallback.

### Files to Change

1. **`node_modules/@radix-ui/react-compose-refs/dist/index.mjs`** -- Overwrite with React 18-safe ESM version:
   - Replace `return ref(value)` with `ref(value)` (no return)
   - Remove cleanup-tracking logic from `composeRefs`
   - Keep the same exports (`composeRefs`, `useComposedRefs`)

2. **`node_modules/@radix-ui/react-compose-refs/dist/index.js`** -- Overwrite with React 18-safe CJS version:
   - Same logic changes as the ESM version
   - Keep CJS module format

3. **`vite.config.ts`** -- Fix the esbuild plugin:
   - Add `resolveDir` pointing to the package's `dist/` directory so esbuild can resolve `react` imports
   - Broaden the `onLoad` filter to match both `.mjs` and `.js` variants
   - Keep `force: true` to ensure the patched files are picked up

4. **`src/lib/radix-compose-refs-patch.ts`** -- Delete (no longer needed as a separate file since we are patching at source)

5. **`vite.config.ts` resolve.alias** -- Remove the `@radix-ui/react-compose-refs` alias entry (no longer needed)

### Technical Details

The patched `setRef` function (both ESM and CJS):
```text
function setRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);          // <-- no "return", prevents cleanup dispatch loop
  } else if (ref !== null && ref !== undefined) {
    ref.current = value;
  }
}
```

The patched `composeRefs` function:
```text
function composeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => setRef(ref, node));
  };
  // No cleanup tracking -- React 18 does not support ref cleanup returns
}
```

### Why This Will Work
- Directly overwriting the source files means every Radix package that imports from `@radix-ui/react-compose-refs` will get the fixed code, whether during pre-bundling or at runtime
- The esbuild plugin acts as a safety net with the corrected `resolveDir` parameter
- No more reliance on build-cache timing or alias resolution order

