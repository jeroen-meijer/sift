import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createStore, useStoreSelector } from "./store";

describe("createStore", () => {
  it("does not notify when the value is unchanged", () => {
    const store = createStore(1);
    const fn = vi.fn();
    store.subscribe(fn);
    store.set(1);
    expect(fn).not.toHaveBeenCalled();
    store.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("re-renders a selector only when the selected value changes", () => {
    const store = createStore({ a: 1, b: 1 });
    let renders = 0;
    function ShowA() {
      renders += 1;
      return <span>{useStoreSelector(store, (s) => s.a)}</span>;
    }
    render(<ShowA />);
    const base = renders;
    act(() => {
      store.set({ a: 1, b: 2 });
    });
    expect(renders).toBe(base);
    act(() => {
      store.set({ a: 2, b: 2 });
    });
    expect(renders).toBe(base + 1);
  });
});
