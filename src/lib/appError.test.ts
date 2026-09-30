import { describe, expect, it } from "vitest";
import { formatErrorCopyPayload, parseInvokeError } from "./appError";
import { dismissAppError, errorToastStore, showAppError } from "./errorToastStore";

describe("parseInvokeError", () => {
  it("reads code and detail from an object payload", () => {
    expect(parseInvokeError({ code: "play.failed", detail: "device gone" })).toEqual({
      code: "play.failed",
      detail: "device gone",
    });
  });

  it("parses a JSON message string", () => {
    expect(
      parseInvokeError({ message: JSON.stringify({ code: "sample.not_found" }) }),
    ).toEqual({ code: "sample.not_found" });
  });
});

describe("errorToastStore", () => {
  it("replaces the previous toast instead of stacking", () => {
    showAppError({ code: "play.failed" });
    const first = errorToastStore.get().seq;
    showAppError({ code: "sample.not_found" });
    const second = errorToastStore.get();
    expect(second.payload?.code).toBe("sample.not_found");
    expect(second.seq).toBe(first + 1);
    dismissAppError();
    expect(errorToastStore.get().payload).toBeNull();
  });
});

describe("formatErrorCopyPayload", () => {
  it("includes code, message, and version", () => {
    const text = formatErrorCopyPayload("play.failed", "Could not play.", "boom", "0.5.0");
    expect(text).toContain("code: play.failed");
    expect(text).toContain("message: Could not play.");
    expect(text).toContain("detail: boom");
    expect(text).toContain("version: 0.5.0");
  });
});
