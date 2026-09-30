import { createStore } from "./store";
import type { AppErrorPayload } from "./appError";

export interface ErrorToastState {
  payload: AppErrorPayload | null;
  seq: number;
}

export const errorToastStore = createStore<ErrorToastState>({ payload: null, seq: 0 });

/** Replace any existing toast. Never stacks. */
export function showAppError(payload: AppErrorPayload): void {
  const prev = errorToastStore.get();
  errorToastStore.set({ payload, seq: prev.seq + 1 });
}

export function dismissAppError(): void {
  const prev = errorToastStore.get();
  errorToastStore.set({ payload: null, seq: prev.seq });
}
