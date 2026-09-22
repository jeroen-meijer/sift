import { bench, describe } from "vitest";
import { applyTheme } from "./index";

/**
 * Frontend micro-benchmarks (Vitest bench runner).
 * Run: `bun run bench`
 *
 * Heavy audio work lives in Rust (`cargo bench --bench audio_hotpath`).
 * These catch UI helper regressions only.
 */
describe("theme applyTheme", () => {
  bench("set dark-default 1k times", () => {
    for (let i = 0; i < 1000; i += 1) {
      applyTheme("dark-default");
    }
  });
});
