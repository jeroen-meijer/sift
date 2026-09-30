/** Parsed Tauri invoke failure (`AppError` serializes as `{ code, detail? }`). */
export interface AppErrorPayload {
  code: string;
  detail?: string;
}

export function parseInvokeError(err: unknown): AppErrorPayload {
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.code === "string") {
      const detail = typeof obj.detail === "string" ? obj.detail : undefined;
      return detail ? { code: obj.code, detail } : { code: obj.code };
    }
    if (typeof obj.message === "string") {
      try {
        const nested = JSON.parse(obj.message) as unknown;
        if (nested && typeof nested === "object" && typeof (nested as { code?: unknown }).code === "string") {
          return parseInvokeError(nested);
        }
      } catch {
        /* plain string message */
      }
      return { code: "error.generic", detail: obj.message };
    }
  }
  if (typeof err === "string") {
    try {
      return parseInvokeError(JSON.parse(err) as unknown);
    } catch {
      return { code: "error.generic", detail: err };
    }
  }
  return { code: "error.generic", detail: String(err) };
}

/** Locale key path under the `errors` namespace for a dotted code. */
export function errorLocaleKey(code: string): string {
  return code;
}

export function formatErrorCopyPayload(
  code: string,
  localized: string,
  detail: string | undefined,
  version: string,
): string {
  const lines = [`code: ${code}`, `message: ${localized}`, `version: ${version}`];
  if (detail) lines.splice(2, 0, `detail: ${detail}`);
  return lines.join("\n");
}
