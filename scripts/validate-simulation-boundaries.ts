import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = join(root, "packages", "simulation", "src");
const { readdir } = await import("node:fs/promises");
const files = await readdir(sourceRoot, { withFileTypes: true });
const violations: string[] = [];
for (const entry of files) {
  if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
  const path = join(sourceRoot, entry.name);
  const text = readFileSync(path, "utf8");
  const checks: readonly [RegExp, string][] = [
    [/from ["'](?:\.\.\/)*apps\//u, "application dependency"],
    [/from ["']@dragonball-resurgence\/npc-ai["']/u, "npc-ai dependency"],
    [/from ["'](?:\.\.\/)*packages\//u, "workspace deep import"],
    [/(?:Math\.random|Date\.now|new Date\(\))/u, "direct randomness or wall-clock use"],
    [
      /(?:calculateDamage|resolveCombatRule|if \([^\n]*(?:move|item|transformation)\.id)/u,
      "copied combat-rule implementation",
    ],
  ];
  for (const [pattern, label] of checks)
    if (pattern.test(text)) violations.push(`${relative(root, path)}: ${label}`);
}
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log("Validated simulation package boundaries.");
