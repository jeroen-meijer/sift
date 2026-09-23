import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback whose identity never changes but always calls the latest `fn`.
 * Lets memoized children skip re-rendering when a parent passes handlers
 * that close over fresh state.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
