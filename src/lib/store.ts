import { useSyncExternalStore } from "react";

/**
 * A tiny external store. High-rate state (analyze progress, the playhead)
 * lives here instead of in React state at the top of the tree, so only the
 * components that read it re-render.
 */
export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of listeners) fn();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Re-renders only when `select` returns a different value. Return a primitive or a stable reference. */
export function useStoreSelector<T, S>(store: Store<T>, select: (value: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
