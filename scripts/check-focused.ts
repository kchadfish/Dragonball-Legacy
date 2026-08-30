import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceNames = {
  api: "@dragonball-resurgence/api",
  "discord-bot": "@dragonball-resurgence/discord-bot",
  "forum-scanner": "@dragonball-resurgence/forum-scanner",
  "game-config": "@dragonball-resurgence/game-config",
  "game-data": "@dragonball-resurgence/game-data",
  "combat-engine": "@dragonball-resurgence/combat-engine",
  "ai-engine": "@dragonball-resurgence/ai-engine",
  "npc-ai": "@dragonball-resurgence/npc-ai",
  persistence: "@dragonball-resurgence/persistence",
  shared: "@dragonball-resurgence/shared",
  "transformation-evaluator": "@dragonball-resurgence/transformation-evaluator",
} as const;

type WorkspaceName = (typeof workspaceNames)[keyof typeof workspaceNames];
type FullGate = "check" | "quality";

export interface FocusedCheckPlan {
  readonly formatFiles: readonly string[];
  readonly lintFiles: readonly string[];
  readonly typecheckWorkspaces: readonly WorkspaceName[];
  readonly testPaths: readonly string[];
  readonly validatorScripts: readonly string[];
  readonly fullGate?: FullGate;
  readonly notes: readonly string[];
}

const scriptTestPaths = new Set([
  "scripts/check-focused.test.ts",
  "scripts/combat-capability-matrix.test.ts",
  "scripts/ai-capability-matrix.test.ts",
  "scripts/validate-ai-capability-closure.test.ts",
  "scripts/combat-mechanics-inventory.test.ts",
  "scripts/reference-markdown-validation.test.ts",
  "scripts/validate-combat-engine-boundaries.test.ts",
  "scripts/validate-ai-engine-boundaries.test.ts",
]);

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const isPrettierFile = (path: string): boolean =>
  /\.(?:js|mjs|cjs|json|ts|tsx|yml|yaml)$/u.test(path);

const isLintFile = (path: string): boolean => /\.(?:js|mjs|cjs|ts|tsx)$/u.test(path);

const addUnique = <T>(values: T[], value: T): void => {
  if (!values.includes(value)) values.push(value);
};

const setFullGate = (current: FullGate | undefined, next: FullGate): FullGate =>
  current === "quality" || (current === "check" && next === "quality") ? "quality" : next;

const scriptTestPathFor = (path: string): string | undefined => {
  if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return undefined;
  const testPath = path.replace(/\.ts$/u, ".test.ts");
  return scriptTestPaths.has(testPath) ? testPath : undefined;
};

const packageWorkspaceFor = (path: string): WorkspaceName | undefined => {
  const match = /^(?:packages|apps)\/([^/]+)\//u.exec(path);
  if (match === null) return undefined;
  return workspaceNames[match[1] as keyof typeof workspaceNames];
};

export const planFocusedCheck = (inputFiles: readonly string[]): FocusedCheckPlan => {
  const files = [...new Set(inputFiles.map(normalizePath))].sort();
  const formatFiles: string[] = [];
  const lintFiles: string[] = [];
  const typecheckWorkspaces: WorkspaceName[] = [];
  const testPaths: string[] = [];
  const validatorScripts: string[] = [];
  const notes: string[] = [];
  let fullGate: FullGate | undefined;

  const addWorkspace = (workspace: WorkspaceName): void => {
    addUnique(typecheckWorkspaces, workspace);
  };

  const addTestPath = (path: string): void => {
    addUnique(testPaths, path);
  };

  const addCombatImpact = (): void => {
    addWorkspace(workspaceNames["game-config"]);
    addWorkspace(workspaceNames["game-data"]);
    addWorkspace(workspaceNames["combat-engine"]);
    addTestPath("packages/combat-engine/src");
    addTestPath("packages/game-data/src");
    addTestPath("scripts/combat-capability-matrix.test.ts");
    addUnique(validatorScripts, "validate:game-data");
    addUnique(validatorScripts, "validate:combat-engine-boundaries");
  };

  const addGameDataImpact = (): void => {
    addWorkspace(workspaceNames["game-data"]);
    addWorkspace(workspaceNames["combat-engine"]);
    addTestPath("packages/game-data/src");
    addTestPath("packages/combat-engine/src");
    addUnique(validatorScripts, "validate:game-data");
  };

  const addGameConfigImpact = (): void => {
    addWorkspace(workspaceNames["game-config"]);
    addWorkspace(workspaceNames["combat-engine"]);
    addTestPath("packages/combat-engine/src");
  };

  for (const file of files) {
    if (isPrettierFile(file)) addUnique(formatFiles, file);
    if (isLintFile(file)) addUnique(lintFiles, file);

    if (file.startsWith("packages/combat-engine/")) {
      addCombatImpact();
      continue;
    }
    if (file.startsWith("packages/game-data/")) {
      addGameDataImpact();
      continue;
    }
    if (file.startsWith("packages/game-config/")) {
      addGameConfigImpact();
      continue;
    }

    if (file.startsWith("packages/ai-engine/")) {
      addWorkspace(workspaceNames["ai-engine"]);
      addTestPath("packages/ai-engine/src");
      addUnique(validatorScripts, "validate:ai-engine-boundaries");
      continue;
    }

    const workspace = packageWorkspaceFor(file);
    if (workspace !== undefined) {
      addWorkspace(workspace);
      if (file.endsWith(".test.ts")) addTestPath(file);
      if (file.endsWith("/package.json")) fullGate = setFullGate(fullGate, "quality");
      continue;
    }

    if (file.startsWith("scripts/")) {
      if (file.endsWith(".test.ts")) {
        addTestPath(file);
      } else {
        const pairedTest = scriptTestPathFor(file);
        if (pairedTest !== undefined) {
          addTestPath(pairedTest);
        } else if (file === "scripts/validate-game-data.ts") {
          addUnique(validatorScripts, "validate:game-data");
        } else if (file === "scripts/validate-combat-engine-boundaries.ts") {
          addUnique(validatorScripts, "validate:combat-engine-boundaries");
        } else if (file === "scripts/validate-ai-engine-boundaries.ts") {
          addUnique(validatorScripts, "validate:ai-engine-boundaries");
        } else if (file === "scripts/validate-ai-capability-closure.ts") {
          addUnique(validatorScripts, "validate:ai-capability-closure");
        } else if (file === "scripts/validate-reference-markdown.ts") {
          addUnique(validatorScripts, "validate:reference-markdown");
        } else if (!file.endsWith("/check-focused.ts")) {
          fullGate = setFullGate(fullGate, "check");
          notes.push(`${file} has no focused test or validator mapping.`);
        }
      }
      continue;
    }

    if (file === "package.json") continue;
    if (file === "package-lock.json" || file === "vitest.config.ts" || file === ".jscpd.json") {
      fullGate = setFullGate(fullGate, "quality");
      continue;
    }
    if (
      file === "tsconfig.json" ||
      file === "tsconfig.base.json" ||
      file === "eslint.config.mjs" ||
      file === ".prettierrc.json" ||
      file === ".prettierignore"
    ) {
      fullGate = setFullGate(fullGate, "check");
      continue;
    }

    if (
      file.startsWith(".github/") ||
      file.startsWith("docker/") ||
      file === "docker-compose.yml"
    ) {
      fullGate = setFullGate(fullGate, "quality");
      continue;
    }

    if (
      !file.startsWith("docs/") &&
      !file.startsWith("reference/") &&
      file !== "AGENTS.md" &&
      file !== "ARCHITECTURE.md" &&
      file !== "BALANCE_TODO.md" &&
      file !== "README.md"
    ) {
      fullGate = setFullGate(fullGate, "check");
      notes.push(`${file} is outside the focused impact map.`);
    }
  }

  return {
    formatFiles: formatFiles.sort(),
    lintFiles: lintFiles.sort(),
    typecheckWorkspaces: typecheckWorkspaces.sort(),
    testPaths: testPaths.sort(),
    validatorScripts: validatorScripts.sort(),
    ...(fullGate === undefined ? {} : { fullGate }),
    notes: [...new Set(notes)].sort(),
  };
};

const gitFiles = (args: readonly string[]): readonly string[] => {
  const output = execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map(normalizePath);
};

export const collectChangedFiles = (): readonly string[] =>
  [
    ...new Set([
      ...gitFiles(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
      ...gitFiles(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ].sort();

const localToolEntrypoints = {
  eslint: ["eslint", "bin", "eslint.js"],
  prettier: ["prettier", "bin", "prettier.cjs"],
  vitest: ["vitest", "vitest.mjs"],
} as const;

const localExecutable = (name: keyof typeof localToolEntrypoints): string =>
  resolve(repositoryRoot, "node_modules", ...localToolEntrypoints[name]);

const runNpm = (args: readonly string[]): void => {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["npm.cmd", ...args].join(" ")] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const runLocal = (name: keyof typeof localToolEntrypoints, args: readonly string[]): void => {
  const result = spawnSync(process.execPath, [localExecutable(name), ...args], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const printPlan = (files: readonly string[], plan: FocusedCheckPlan, coverage: boolean): void => {
  console.log(`Focused check: ${files.length} changed file${files.length === 1 ? "" : "s"}.`);
  if (plan.fullGate !== undefined) {
    console.log(`Configuration or unmapped changes require: npm run ${plan.fullGate}`);
    for (const note of plan.notes) console.log(`  Note: ${note}`);
    return;
  }
  if (plan.formatFiles.length > 0) console.log(`  Prettier: ${plan.formatFiles.length} file(s)`);
  if (plan.lintFiles.length > 0) console.log(`  ESLint: ${plan.lintFiles.length} file(s)`);
  if (plan.typecheckWorkspaces.length > 0)
    console.log(`  Typecheck: ${plan.typecheckWorkspaces.join(", ")}`);
  if (plan.testPaths.length > 0)
    console.log(`  Tests: ${plan.testPaths.join(", ")}${coverage ? " with coverage" : ""}`);
  for (const validator of plan.validatorScripts) console.log(`  Validator: npm run ${validator}`);
  for (const note of plan.notes) console.log(`  Note: ${note}`);
};

const runPlan = (plan: FocusedCheckPlan, coverage: boolean): void => {
  if (plan.fullGate !== undefined) {
    runNpm(["run", plan.fullGate]);
    return;
  }
  if (plan.formatFiles.length > 0) runLocal("prettier", ["--check", ...plan.formatFiles]);
  if (plan.lintFiles.length > 0) runLocal("eslint", plan.lintFiles);
  for (const workspace of plan.typecheckWorkspaces)
    runNpm(["run", "typecheck", "--workspace", workspace]);
  for (const validator of plan.validatorScripts) runNpm(["run", validator]);
  if (plan.testPaths.length > 0) {
    runLocal("vitest", ["run", ...(coverage ? ["--coverage"] : []), ...plan.testPaths]);
  }
};

const main = (): void => {
  const args = process.argv.slice(2);
  const coverage = args.includes("--coverage");
  const unknownArgs = args.filter((arg) => arg !== "--coverage");
  if (unknownArgs.length > 0) {
    throw new Error("Usage: npm run check:focused [-- --coverage]");
  }

  const files = collectChangedFiles();
  if (files.length === 0) {
    console.log("Focused check: no changed files detected.");
    return;
  }

  const plan = planFocusedCheck(files);
  printPlan(files, plan, coverage);
  runPlan(plan, coverage);
  console.log("Focused check passed.");
};

const currentModulePath = resolve(process.argv[1] ?? "");
if (currentModulePath === resolve(fileURLToPath(import.meta.url))) main();
