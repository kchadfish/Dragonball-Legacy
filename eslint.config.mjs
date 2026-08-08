import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import { fileURLToPath, URL } from "node:url";

const typeScriptFiles = ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts", "scripts/**/*.ts"];

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

const sizeRules = {
  "sonarjs/cognitive-complexity": ["error", 15],
  complexity: ["warn", 15],
  "max-depth": ["warn", 4],
  "max-nested-callbacks": ["warn", 3],
  "max-params": ["warn", 5],
  "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
  "max-statements": ["warn", 40],
};

const staticDataRuleOverrides = Object.fromEntries(
  Object.keys(sizeRules).map((rule) => [rule, "off"]),
);

export default tseslint.config(
  {
    ignores: [
      "coverage/",
      "dist/",
      "node_modules/",
      "**/coverage/**",
      "**/dist/**",
      // These files are generated from curated source material and validated separately.
      "packages/game-data/src/**/*-definitions.ts",
      "packages/game-data/src/move-source-definitions.ts",
      "packages/game-data/src/reference-documents.ts",
    ],
  },
  { plugins: { sonarjs } },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  {
    files: typeScriptFiles,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    rules: {
      ...sizeRules,
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: typeScriptFiles,
    rules: sonarjs.configs.recommended.rules,
    settings: sonarjs.configs.recommended.settings,
    ignores: [
      "**/*.{test,spec}.ts",
      "**/testing/**/*.ts",
      "scripts/**/*.ts",
      // Declarative game data is validated by validate:game-data, not SonarJS.
      "packages/game-data/src/moves/**/*.ts",
      "packages/game-data/src/styles/**/*.ts",
      "packages/game-data/src/shared/**/*.ts",
    ],
  },
  {
    // Tests and fixtures are executable but intentionally descriptive and may be long.
    files: ["**/*.{test,spec}.ts", "**/fixtures/**/*.ts"],
    rules: staticDataRuleOverrides,
  },
  {
    // Moves and styles are declarative game data, where repetition conveys game rules.
    files: ["packages/game-data/src/moves/**/*.ts", "packages/game-data/src/styles/**/*.ts"],
    rules: staticDataRuleOverrides,
  },
  {
    // Conversion and repository-validation scripts are tooling, not application code.
    files: ["scripts/**/*.ts"],
    rules: staticDataRuleOverrides,
  },
  prettier,
);
