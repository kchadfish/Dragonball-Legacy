import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const workspacePackagePrefix = "@dragonball-resurgence/";
const combatEngineRoot = "packages/combat-engine";
const combatEngineSourceRoot = join(combatEngineRoot, "src");
const mechanicsViewAssemblyPath = join(combatEngineSourceRoot, "mechanics-view.ts");
const packageJsonPath = join(combatEngineRoot, "package.json");
const tsconfigPath = join(combatEngineRoot, "tsconfig.json");
const allowedWorkspaceDependencies = new Set([
  "@dragonball-resurgence/game-config",
  "@dragonball-resurgence/game-data",
]);
const workspacePackagePaths: Readonly<Record<string, string>> = {
  "@dragonball-resurgence/game-config": "packages/game-config/package.json",
  "@dragonball-resurgence/game-data": "packages/game-data/package.json",
};

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;

const listTypeScriptFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(path);
      return entry.isFile() && path.endsWith(".ts") ? [path] : [];
    }),
  );

  return nestedFiles.flat();
};

const getImportSpecifiers = (source: string): readonly string[] =>
  [...source.matchAll(importPattern)].map((match) => match[1]);

export const validateCombatEngineBoundaries = async (): Promise<readonly string[]> => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
  };
  const errors: string[] = [];

  const mechanicsViewAssembly = await readFile(mechanicsViewAssemblyPath, "utf8");
  for (const requiredExport of [
    "MechanicsViewIdentity",
    "mechanicsViewIdentitySchema",
    "CombatMechanicsView",
    "createCombatMechanicsView",
    "CANONICAL_COMBAT_MECHANICS_VIEW",
  ]) {
    if (
      !new RegExp(`(?:interface|type|const|export const)\\s+${requiredExport}\\b`, "u").test(
        mechanicsViewAssembly,
      )
    )
      errors.push(`mechanics-view.ts must define or export ${requiredExport}.`);
  }

  if (packageJson.exports?.["."] === undefined) {
    errors.push("combat-engine must export its public root entry point.");
  }
  if (packageJson.exports?.["./testing"] === undefined) {
    errors.push("combat-engine must export a public ./testing entry point.");
  }

  for (const dependency of allowedWorkspaceDependencies) {
    if (packageJson.dependencies?.[dependency] === undefined) {
      errors.push(`combat-engine must declare ${dependency} as a dependency.`);
    }

    const dependencyManifest = JSON.parse(
      await readFile(workspacePackagePaths[dependency], "utf8"),
    ) as { readonly exports?: Readonly<Record<string, unknown>> };
    if (dependencyManifest.exports?.["."] === undefined) {
      errors.push(`${dependency} must expose its public root entry point.`);
    }
  }

  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8")) as {
    readonly references?: readonly { readonly path?: string }[];
  };
  const projectReferences = new Set(
    tsconfig.references?.flatMap((reference) =>
      reference.path === undefined ? [] : [reference.path],
    ),
  );
  for (const expectedReference of ["../game-config", "../game-data"]) {
    if (!projectReferences.has(expectedReference)) {
      errors.push(`combat-engine must reference ${expectedReference} in tsconfig.json.`);
    }
  }

  for (const file of await listTypeScriptFiles(combatEngineSourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const specifier of getImportSpecifiers(source)) {
      if (!specifier.startsWith(workspacePackagePrefix)) continue;

      if (specifier.includes("/src/") || specifier.includes("/dist/")) {
        errors.push(`${relative(combatEngineRoot, file)} deep-imports ${specifier}.`);
        continue;
      }
      if (!allowedWorkspaceDependencies.has(specifier)) {
        errors.push(
          `${relative(combatEngineRoot, file)} imports unsupported workspace package ${specifier}.`,
        );
        continue;
      }
      if (packageJson.dependencies?.[specifier] === undefined) {
        errors.push(
          `${relative(combatEngineRoot, file)} imports undeclared dependency ${specifier}.`,
        );
      }
    }
  }

  return errors;
};

if (process.argv[1]?.endsWith("validate-combat-engine-boundaries.ts")) {
  const errors = await validateCombatEngineBoundaries();
  if (errors.length > 0) throw new Error(errors.join("\n"));

  console.log(
    `Validated combat-engine workspace boundaries across ${
      (await listTypeScriptFiles(combatEngineSourceRoot)).length
    } TypeScript files.`,
  );
}
