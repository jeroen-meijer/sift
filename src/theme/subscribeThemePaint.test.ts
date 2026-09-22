import { describe, expect, it } from "vitest";
import {
  subscribeThemePaint,
  themePaintListenerCount,
} from "./subscribeThemePaint";

describe("subscribeThemePaint", () => {
  it("shares one listener set across subscribers", () => {
    const a = () => undefined;
    const b = () => undefined;
    const offA = subscribeThemePaint(a);
    const offB = subscribeThemePaint(b);
    expect(themePaintListenerCount()).toBe(2);
    offA();
    expect(themePaintListenerCount()).toBe(1);
    offB();
    expect(themePaintListenerCount()).toBe(0);
  });
});
