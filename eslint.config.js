// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist", "coverage", "node_modules", "src-tauri/target", "src-tauri/gen", "scripts"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Tauri IPC: load settings/library on mount via invoke(). That pattern
      // sets React state from an effect by design; prefer Query later if needed.
      "react-hooks/set-state-in-effect": "off",
      // TanStack Virtual is intentional; React Compiler cannot memoize its API.
      "react-hooks/incompatible-library": "off",
      // Event handlers often `void invoke(...)`; allow concise void arrows.
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreVoidOperator: true },
      ],
      // Conflicts with ignoreVoidOperator (eslint circular-fix loop on void setters).
      "@typescript-eslint/no-meaningless-void-operator": "off",
    },
  },
);
