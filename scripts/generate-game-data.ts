import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = join(repositoryRoot, "reference");
const outputPath = join(repositoryRoot, "packages/game-data/src/reference-documents.ts");

const classify = (sourcePath: string): string => {
  if (sourcePath === "rules.md") return "rules";
  if (sourcePath.startsWith("moves/")) return "moves";
  if (sourcePath.startsWith("items/")) return "items";
  if (sourcePath.startsWith("quests/")) return "quest";
  if (sourcePath.includes("/race.md")) return "race";
  if (sourcePath.includes("transformation")) return "transformations";
  if (sourcePath.endsWith("locations-and-trainers.md")) return "trainers";
  if (sourcePath.startsWith("planet/")) return "location";
  return "reference";
};

const toId = (sourcePath: string): string =>
  sourcePath
    .replace(/\.md$/u, "")
    .replace(/[/\s_]+/gu, "-")
    .replace(/([a-z])([A-Z])/gu, "$1-$2")
    .replace(/[^a-zA-Z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();

const collectMarkdownFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectMarkdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return files.flat();
};

const nonDataReferenceFiles = new Set([
  "charactersheet.md",
  "data-authoring.md",
  "normalization-decisions.md",
  "semantic-conversion-progress.md",
]);
const sourceFiles = (await collectMarkdownFiles(referenceRoot))
  .filter((path) => !nonDataReferenceFiles.has(relative(referenceRoot, path).split(sep).join("/")))
  .sort();

const toMoveId = (sourcePath: string, name: string): string =>
  `move-${toId(sourcePath).replace(/^moves-/u, "")}-${toId(name)}`;

const fieldValue = (content: string, field: string): string | undefined => {
  const match = new RegExp(`^${field}:\\s*(.+)$`, "mu").exec(content);
  return match?.[1]?.trim();
};

const lineForOffset = (content: string, offset: number): number =>
  content.slice(0, offset).split("\n").length;

interface GeneratedMoveDefinition {
  readonly id: string;
  readonly name: string;
  readonly declaredTags: readonly string[];
  readonly category?: string;
  readonly description: string;
  readonly effectText: string;
  readonly effectClauses: readonly {
    readonly order: number;
    readonly text: string;
    readonly ruleTokens: readonly string[];
  }[];
  readonly mechanics: Record<string, unknown>;
  readonly requirementsText: string;
  readonly trainingDays?: number;
  readonly source: { readonly path: string; readonly text: string };
}

interface GeneratedUnresolvedMoveSource {
  readonly sourcePath: string;
  readonly line: number;
  readonly name: string;
  readonly reason: string;
  readonly sourceText: string;
}

const moveDefinitions: GeneratedMoveDefinition[] = [];
const unresolvedMoveSources: GeneratedUnresolvedMoveSource[] = [];

const numericExpression = (
  text: string,
): { readonly type: string; readonly value?: number; readonly text?: string } => {
  const normalized = text.trim();
  return /^\d+$/u.test(normalized)
    ? { type: "literal", value: Number(normalized) }
    : { type: "source-expression", text: normalized };
};

const mechanicsFor = (effectText: string): Record<string, unknown> => {
  const cost = /Cost:\s*([^.]*)\s+KI\b/iu.exec(effectText)?.[1];
  const restrictedUses = /RESTRICTEDx(\d+)/iu.exec(effectText)?.[1];
  const timingText = /Timing:\s*([^.]*)\./iu.exec(effectText)?.[1];
  const attackType = /\b(Physical|Energy) attack\./iu.exec(effectText)?.[1]?.toLowerCase();
  const damage = /Deal \(([^)]*)\) damage/iu.exec(effectText)?.[1];
  const damagePercent = damage?.replace(/\s+per hit$/iu, "").match(/^(\d+)% Power$/iu)?.[1];
  const attackRoll = /Attack roll:\s*(\d+)d(\d+)/iu.exec(effectText);
  const attack =
    attackType === undefined
      ? undefined
      : {
          type: attackType,
          ...(damage === undefined
            ? {}
            : {
                baseDamagePercent:
                  damagePercent === undefined
                    ? numericExpression(damage)
                    : numericExpression(damagePercent),
              }),
          ...(damage?.toLowerCase().includes("per hit") === true ? { damagePerHit: true } : {}),
          ...(attackRoll === null
            ? {}
            : { attackRoll: { dice: Number(attackRoll[1]), sides: Number(attackRoll[2]) } }),
        };

  return {
    ...(cost === undefined ? {} : { kiCost: numericExpression(cost) }),
    ...(restrictedUses === undefined ? {} : { restrictedUses: numericExpression(restrictedUses) }),
    ...(timingText === undefined ? {} : { timingText }),
    ...(attack === undefined ? {} : { attack }),
  };
};

const ruleTokens = [
  "break",
  "cooldown",
  "counter",
  "critical",
  "deactivate",
  "lock",
  "negate",
  "sever",
  "stopped",
  "stun",
  "successful",
  "suppress",
] as const;

const clausesFor = (effectText: string) =>
  effectText
    .split(/(?<=[.!?])\s+(?=[A-Z[])/u)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      order: index + 1,
      text,
      ruleTokens: ruleTokens.filter((token) => new RegExp(`\\b${token}\\b`, "iu").test(text)),
    }));

for (const path of sourceFiles.filter((file) =>
  relative(referenceRoot, file).startsWith(`moves${sep}`),
)) {
  const sourcePath = relative(referenceRoot, path).split(sep).join("/");
  const document = await readFile(path, "utf8");
  const headings = [...document.matchAll(/^## (.+?)(?: \[([^\]]+)\])?\s*$/gmu)];

  for (const [index, heading] of headings.entries()) {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? document.length;
    const sourceText = document.slice(start, end).trim();
    const name = heading[1]?.trim() ?? "";
    const tags =
      heading[2]
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean) ?? [];
    const precedingContent = document.slice(0, start);
    const category = tags.includes("MASTERY")
      ? "mastery"
      : tags.includes("BLOCK")
        ? "block"
        : tags.some((tag) => tag.endsWith("SKILL"))
          ? "skill"
          : precedingContent.lastIndexOf("Signature Techniques") >
              precedingContent.lastIndexOf("Advanced Attacks")
            ? "signature"
            : precedingContent.includes("Advanced Attacks")
              ? "advanced-attack"
              : undefined;
    const description = fieldValue(sourceText, "Description");
    const effectText = fieldValue(sourceText, "Effect");
    const requirementsText = fieldValue(sourceText, "Requirements");
    const trainingDaysText = fieldValue(sourceText, "Training Days");
    const trainingDays = trainingDaysText === undefined ? undefined : Number(trainingDaysText);
    const reasons = [
      tags.length === 0 ? "missing tags" : undefined,
      description === undefined ? "missing description" : undefined,
      effectText === undefined ? "missing effect" : undefined,
      requirementsText === undefined ? "missing requirements" : undefined,
      trainingDaysText !== undefined && !Number.isSafeInteger(trainingDays)
        ? "invalid training days"
        : undefined,
    ].filter((reason): reason is string => reason !== undefined);

    if (reasons.length > 0) {
      unresolvedMoveSources.push({
        sourcePath: `reference/${sourcePath}`,
        line: lineForOffset(document, start),
        name,
        reason: reasons.join(", "),
        sourceText,
      });
      continue;
    }

    moveDefinitions.push({
      id: toMoveId(sourcePath, name),
      name,
      declaredTags: tags,
      ...(category === undefined ? {} : { category }),
      description,
      effectText,
      effectClauses: clausesFor(effectText),
      mechanics: mechanicsFor(effectText),
      requirementsText,
      ...(trainingDays === undefined ? {} : { trainingDays }),
      source: { path: `reference/${sourcePath}`, text: sourceText },
    });
  }
}

const seenMoveIds = new Set<string>();
const generatedMoveDefinitions = moveDefinitions.filter(({ id }) => {
  if (seenMoveIds.has(id)) return false;
  seenMoveIds.add(id);
  return true;
});
const documents = await Promise.all(
  sourceFiles.map(async (path) => {
    const sourcePath = relative(referenceRoot, path).split(sep).join("/");
    return {
      id: toId(sourcePath),
      kind: classify(sourcePath),
      sourcePath: `reference/${sourcePath}`,
      content: await readFile(path, "utf8"),
    };
  }),
);

const duplicateIds = documents
  .map(({ id }) => id)
  .filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate game-data document IDs: ${duplicateIds.join(", ")}`);
}

const output = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { GameDataDocument } from "./shared/types.js";',
  "",
  `export const GAME_DATA_DOCUMENTS: readonly GameDataDocument[] = ${JSON.stringify(documents, null, 2)};`,
  "",
].join("\n");

await writeFile(outputPath, output);

const moveOutputPath = join(repositoryRoot, "packages/game-data/src/move-source-definitions.ts");
const moveOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { MoveSourceDefinition, UnresolvedMoveSource } from "./shared/types.js";',
  "",
  `export const MOVE_SOURCE_DEFINITIONS: readonly MoveSourceDefinition[] = ${JSON.stringify(generatedMoveDefinitions, null, 2)};`,
  "",
  `export const UNRESOLVED_MOVE_SOURCES: readonly UnresolvedMoveSource[] = ${JSON.stringify(unresolvedMoveSources, null, 2)};`,
  "",
].join("\n");

await writeFile(moveOutputPath, moveOutput);
