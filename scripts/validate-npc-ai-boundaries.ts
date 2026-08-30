import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = "packages/npc-ai";
const sourceRoot = join(root, "src");
const packageJsonPath = join(root, "package.json");
const allowed = new Set([
  "@dragonball-resurgence/ai-engine",
  "@dragonball-resurgence/combat-engine",
  "@dragonball-resurgence/game-config",
  "@dragonball-resurgence/game-data",
]);
const imports = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;

const filesUnder = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return filesUnder(path);
        return entry.isFile() && path.endsWith(".ts") ? [path] : [];
      }),
    )
  ).flat();
};

export const validateNpcAiBoundaries = async (): Promise<readonly string[]> => {
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
  };
  const errors: string[] = [];
  if (manifest.name !== "@dragonball-resurgence/npc-ai")
    errors.push("npc-ai must declare its canonical workspace name.");
  if (manifest.exports?.["."] === undefined)
    errors.push("npc-ai must expose its public root entry point.");
  const dependencies = new Set(Object.keys(manifest.dependencies ?? {}));
  for (const dependency of allowed)
    if (!dependencies.has(dependency)) errors.push(`npc-ai must declare ${dependency}.`);
  for (const file of await filesUnder(sourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const [, specifier] of source.matchAll(imports)) {
      if (!specifier.startsWith("@dragonball-resurgence/")) continue;
      if (specifier.includes("/src/") || specifier.includes("/dist/"))
        errors.push(`${relative(root, file)} deep-imports ${specifier}.`);
      else if (!allowed.has(specifier))
        errors.push(`${relative(root, file)} imports unsupported package ${specifier}.`);
      else if (!dependencies.has(specifier))
        errors.push(`${relative(root, file)} imports undeclared dependency ${specifier}.`);
    }
  }
  return errors;
};

if (process.argv[1]?.endsWith("validate-npc-ai-boundaries.ts")) {
  const errors = await validateNpcAiBoundaries();
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log("Validated npc-ai workspace boundaries.");
}
