import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const aiEngineRoot = "packages/ai-engine";
const aiEngineSourceRoot = join(aiEngineRoot, "src");
const packageJsonPath = join(aiEngineRoot, "package.json");
const tsconfigPath = join(aiEngineRoot, "tsconfig.json");
const workspacePackagePrefix = "@dragonball-resurgence/";
const allowedWorkspaceDependencies = new Set([
  "@dragonball-resurgence/shared",
  "@dragonball-resurgence/game-config",
  "@dragonball-resurgence/game-data",
  "@dragonball-resurgence/combat-engine",
]);
const workspacePackagePaths: Readonly<Record<string, string>> = {
  "@dragonball-resurgence/shared": "packages/shared/package.json",
  "@dragonball-resurgence/game-config": "packages/game-config/package.json",
  "@dragonball-resurgence/game-data": "packages/game-data/package.json",
  "@dragonball-resurgence/combat-engine": "packages/combat-engine/package.json",
};
const forbiddenWorkspaceImports = new Set([
  "@dragonball-resurgence/npc-ai",
  "@dragonball-resurgence/persistence",
  "@dragonball-resurgence/api",
  "@dragonball-resurgence/discord-bot",
  "@dragonball-resurgence/forum-scanner",
]);

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

export const validateAiEngineBoundaries = async (): Promise<readonly string[]> => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
  };
  const errors: string[] = [];
  if (packageJson.name !== "@dragonball-resurgence/ai-engine") {
    errors.push("ai-engine must declare its canonical workspace name.");
  }
  if (packageJson.exports?.["."] === undefined) {
    errors.push("ai-engine must export its public root entry point.");
  }
  const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
  for (const dependency of allowedWorkspaceDependencies) {
    if (!dependencies.has(dependency)) errors.push(`ai-engine must declare ${dependency}.`);
    const dependencyManifest = JSON.parse(
      await readFile(workspacePackagePaths[dependency], "utf8"),
    ) as { readonly exports?: Readonly<Record<string, unknown>> };
    if (dependencyManifest.exports?.["."] === undefined) {
      errors.push(`${dependency} must expose its public root entry point.`);
    }
  }
  for (const dependency of dependencies) {
    if (!allowedWorkspaceDependencies.has(dependency)) {
      errors.push(`ai-engine declares unsupported workspace dependency ${dependency}.`);
    }
  }

  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8")) as {
    readonly references?: readonly { readonly path?: string }[];
  };
  const references = new Set(
    tsconfig.references?.flatMap((reference) =>
      reference.path === undefined ? [] : [reference.path],
    ),
  );
  for (const expected of ["../shared", "../game-config", "../game-data", "../combat-engine"]) {
    if (!references.has(expected))
      errors.push(`ai-engine must reference ${expected} in tsconfig.json.`);
  }

  for (const file of await listTypeScriptFiles(aiEngineSourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const specifier of getImportSpecifiers(source)) {
      if (!specifier.startsWith(workspacePackagePrefix)) continue;
      if (specifier.includes("/src/") || specifier.includes("/dist/")) {
        errors.push(`${relative(aiEngineRoot, file)} deep-imports ${specifier}.`);
      } else if (forbiddenWorkspaceImports.has(specifier)) {
        errors.push(`${relative(aiEngineRoot, file)} imports forbidden package ${specifier}.`);
      } else if (!allowedWorkspaceDependencies.has(specifier)) {
        errors.push(`${relative(aiEngineRoot, file)} imports unsupported package ${specifier}.`);
      } else if (!dependencies.has(specifier)) {
        errors.push(`${relative(aiEngineRoot, file)} imports undeclared dependency ${specifier}.`);
      }
    }
  }
  return errors;
};

if (process.argv[1]?.endsWith("validate-ai-engine-boundaries.ts")) {
  const errors = await validateAiEngineBoundaries();
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log("Validated ai-engine workspace boundaries.");
}
