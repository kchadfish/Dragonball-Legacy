import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = join(repositoryRoot, "reference");
const outputPath = join(repositoryRoot, "packages/game-data/src/reference-documents.ts");
const itemOutputPath = join(repositoryRoot, "packages/game-data/src/item-definitions.ts");
const raceOutputPath = join(repositoryRoot, "packages/game-data/src/race-definitions.ts");
const transformationOutputPath = join(
  repositoryRoot,
  "packages/game-data/src/transformation-definitions.ts",
);
const locationOutputPath = join(repositoryRoot, "packages/game-data/src/location-definitions.ts");
const questOutputPath = join(repositoryRoot, "packages/game-data/src/quest-definitions.ts");
const sagaRuleOutputPath = join(repositoryRoot, "packages/game-data/src/saga-rule-definitions.ts");

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
  "oldPCExamples.md",
  "semantic-conversion-progress.md",
]);
const sourceFiles = (await collectMarkdownFiles(referenceRoot))
  .filter((path) => !nonDataReferenceFiles.has(relative(referenceRoot, path).split(sep).join("/")))
  .sort();

const toMoveId = (sourcePath: string, name: string): string =>
  `move-${toId(sourcePath).replace(/^moves-/u, "")}-${toId(name)}`;

const toItemId = (sourcePath: string, name: string): string =>
  `item-${toId(sourcePath).replace(/^items-/u, "")}-${toId(name)}`;

const toRaceId = (directory: string): string => `race-${toId(directory)}`;

const toTransformationId = (raceId: string, tier: number, name: string): string =>
  `transformation-${raceId.replace(/^race-/u, "")}-${tier}-${toId(name)}`;

const toLocationId = (sourcePath: string): string =>
  `location-${toId(sourcePath.replace(/^planet\//u, "").replace(/\.md$/u, ""))}`;

const toQuestId = (sourcePath: string, name: string): string =>
  `quest-${toId(sourcePath.replace(/^quests\//u, "").replace(/\.md$/u, ""))}-${toId(name)}`;

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

const itemFieldValue = (sourceText: string, field: string): string | undefined =>
  new RegExp(`^${field}:\\s*(.+)$`, "mu").exec(sourceText)?.[1]?.trim();

const itemEffectsFor = (effectText: string): readonly Record<string, unknown>[] => {
  const effects: Record<string, unknown>[] = [];
  for (const clause of clausesFor(effectText)) {
    for (const match of clause.text.matchAll(
      /([+-]?\s*\d+)%\s*(Power|HP|Health|Dexterity|Dex|All Stats)\b/giu,
    )) {
      const statName = (match[2] ?? "").toLowerCase();
      effects.push({
        trigger: /for the next week/iu.test(clause.text) ? "on-item-use" : "passive",
        type: "item-modify-stat-percent",
        stat:
          statName === "power"
            ? "power"
            : statName === "dexterity" || statName === "dex"
              ? "dexterity"
              : statName === "all stats"
                ? "all-stats"
                : "hp",
        percent: Number((match[1] ?? "").replace(/\s/gu, "")),
        ...(/for the next week/iu.test(clause.text)
          ? { duration: { unit: "week", value: 1 } }
          : {}),
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(/gain\s+\((\d+)%\s+total\s+hp\)\s+hp/giu)) {
      effects.push({
        trigger: "on-move-use",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: Number(match[1]),
        },
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(/\+(\d+)\s+Inventory Slots/giu)) {
      effects.push({
        trigger: "passive",
        type: "item-modify-inventory-capacity",
        slots: Number(match[1]),
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(/\+(\d+)\s+Max Capacity/giu)) {
      effects.push({
        trigger: "passive",
        type: "item-modify-ship-capacity",
        capacity: Number(match[1]),
        sourceText: match[0] ?? clause.text,
      });
    }
    const travelMatch = /-(\d+)\s*days?\s+to\s+Travel Time/iu.exec(clause.text);
    if (travelMatch !== null) {
      effects.push({
        trigger: "on-travel-start",
        type: "item-reduce-duration",
        activity: "ship-travel",
        amount: Number(travelMatch[1]),
        unit: "days",
        sourceText: travelMatch[0],
      });
    }
    const dragonBallMatch =
      /takes?\s+(?:you\s+)?-(\d+)\s+days?\s+to\s+find a Dragon ?Ball,?\s+to a minimum of\s+(\d+)\s+days/iu.exec(
        clause.text,
      );
    if (dragonBallMatch !== null) {
      effects.push({
        trigger: "passive",
        type: "item-reduce-duration",
        activity: "dragon-ball-search",
        amount: Number(dragonBallMatch[1]),
        minimum: Number(dragonBallMatch[2]),
        unit: "days",
        sourceText: dragonBallMatch[0],
      });
    }
    const questDayMatch =
      /quest takes?\s+-(\d+)\s+days?\s+to perform\s+to a minimum of\s+(\d+)/iu.exec(clause.text);
    if (questDayMatch !== null) {
      effects.push({
        trigger: "on-quest-start",
        type: "item-reduce-duration",
        activity: "quest",
        amount: Number(questDayMatch[1]),
        minimum: Number(questDayMatch[2]),
        unit: "days",
        useLimit: { scope: "saga", count: 1 },
        sourceText: questDayMatch[0],
      });
    }
    const questWpdMatch = /quest take\s+-(\d+)\s+wpd\s+to a minimum of\s+(\d+)\s+wpd/iu.exec(
      clause.text,
    );
    if (questWpdMatch !== null) {
      effects.push({
        trigger: "on-quest-start",
        type: "item-reduce-duration",
        activity: "quest",
        amount: Number(questWpdMatch[1]),
        minimum: Number(questWpdMatch[2]),
        unit: "wpd",
        ...(/once per week/iu.test(effectText) ? { useLimit: { scope: "week", count: 1 } } : {}),
        sourceText: questWpdMatch[0],
      });
    }
    const marketplaceMatch = /items purchased from the marketplace cost\s+(\d+)%\s+less/iu.exec(
      clause.text,
    );
    if (marketplaceMatch !== null) {
      effects.push({
        trigger: "passive",
        type: "item-modify-marketplace-price",
        operation: "discount",
        percent: Number(marketplaceMatch[1]),
        sourceText: marketplaceMatch[0],
      });
    }
    const experienceMatch = /\+(\d+)%\s+exp\s+while\s+(sparring|sparring or battling)/iu.exec(
      clause.text,
    );
    if (experienceMatch !== null) {
      effects.push({
        trigger: "passive",
        type: "item-modify-experience-percent",
        activity: /or battling/iu.test(experienceMatch[2] ?? "") ? "spar-or-battle" : "spar",
        percent: Number(experienceMatch[1]),
        rounding: "nearest",
        sourceText: experienceMatch[0],
      });
    }
    for (const match of clause.text.matchAll(/gain\s+(\d+)\s*ki\s+points?/giu)) {
      effects.push({
        trigger: "combat-action",
        type: "item-modify-resource",
        target: "self",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: Number(match[1]) },
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(
      /(?:your\s+)?attack dice gain\s+\+(\d+)\s+sides?/giu,
    )) {
      effects.push({
        trigger: "combat-action",
        type: "item-modify-roll",
        target: "self",
        roll: "attack",
        modifier: "sides",
        amount: Number(match[1]),
        duration: { unit: "combat" },
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(
      /gain\s+\+(\d+)\s+dice sides to any level transformation dice/giu,
    )) {
      effects.push({
        trigger: "after-spar-or-battle",
        type: "item-modify-roll",
        target: "self",
        roll: "transformation",
        modifier: "sides",
        amount: Number(match[1]),
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(
      /(?:add|gain)\s+\+(\d+)\s+to (?:the )?(?:results? of |result of )?(?:a |your )?(defensive|defense|advanced attack|attack|transformation) roll/giu,
    )) {
      const rollName = (match[2] ?? "").toLowerCase();
      effects.push({
        trigger: /after (?:your |the opponent's )?defen[cs]e roll/iu.test(clause.text)
          ? "after-defense-roll"
          : /before your roll/iu.test(clause.text)
            ? "before-roll"
            : "combat-action",
        type: "item-modify-roll",
        target: "self",
        roll:
          rollName === "defensive" || rollName === "defense"
            ? "defense"
            : rollName === "transformation"
              ? "transformation"
              : "attack",
        modifier: "result",
        amount: Number(match[1]),
        selectorText: rollName === "advanced attack" ? "advanced-attack" : undefined,
        sourceText: match[0] ?? clause.text,
      });
    }
    for (const match of clause.text.matchAll(
      /(next\s+)?(?:[\w\s-]+\s+)?attacks?\s+(?:do|does|gain)\s+\+?\s*\((\d+)%\s+Power\)\s+damage/giu,
    )) {
      effects.push({
        trigger: "combat-action",
        type: "item-modify-damage",
        target: "self",
        percent: Number(match[2]),
        ...(match[1] === undefined ? {} : { duration: { unit: "combat", value: 1 } }),
        sourceText: match[0] ?? clause.text,
      });
    }
    if (/negate a BREAK or SEVER/iu.test(clause.text)) {
      effects.push({
        trigger: "combat-action",
        type: "item-prevent-combat-outcome",
        outcomes: ["break", "sever"],
        sourceText: clause.text,
      });
    }
    const stateRule = (
      operation:
        | "allow-use-after-combat-loss"
        | "limit-healing-item-uses"
        | "modify-recovery-rate"
        | "modify-all-roll-sides"
        | "limit-consecutive-stat-boost-weeks"
        | "modify-skill-slot-capacity"
        | "grant-extra-basic-weapon-action"
        | "prevent-interference"
        | "permit-equipment-change"
        | "prevent-equipment-change-during-combat"
        | "grant-marketplace-access"
        | "waive-ship-pilot-requirement"
        | "pay-activation-ki"
        | "heal-current-hp"
        | "reduce-training-days"
        | "grant-zenni-on-npc-kill"
        | "grant-transformation-roll-sides"
        | "grant-ki-per-combat"
        | "allow-quest-without-battle"
        | "permit-accessory-slot-overflow"
        | "restrict-use-in-purchase-week"
        | "limit-race-item-uses"
        | "grant-resource-when-race"
        | "reflect-attack-damage"
        | "make-advanced-attack-unblockable"
        | "stop-low-roll-unrestricted-attack"
        | "set-attack-roll-result"
        | "reroll-defense-dice"
        | "modify-tagged-attack-cost"
        | "modify-block-cost"
        | "declare-after-defense-roll"
        | "declare-before-roll"
        | "modify-transformation-roll-result"
        | "heal-total-hp-per-day"
        | "grant-ship-storage-access"
        | "transfer-stored-items-on-raid"
        | "increase-other-ship-travel-time"
        | "restrict-space-quest-work"
        | "challenge-dragon-ball-carrier"
        | "activate-after-defense-roll"
        | "activate-on-advanced-attack"
        | "stop-low-firearm-roll"
        | "modify-selected-roll"
        | "deny-challenge"
        | "apply-challenge-cooldown"
        | "select-escape-roll-modifier"
        | "heal-after-item-healing"
        | "select-persistent-stat"
        | "increase-single-die-drain"
        | "protect-combat-state"
        | "forbid-defense-reroll-after-restricted-attack"
        | "roll-space-combat-dice"
        | "set-space-combat-starting-hp"
        | "disable-selected-item-copies"
        | "limit-space-combat-item-use"
        | "resolve-self-destruct"
        | "destroy-item-on-roll-threshold"
        | "grant-post-combat-reward"
        | "declare-after-roll"
        | "pay-hp-for-roll-modifier"
        | "exchange-experience-for-resources"
        | "require-unrestricted-single-physical-attack"
        | "exclude-multi-die-attacks"
        | "activate-on-block"
        | "roll-first-advanced-attack-twice-lower"
        | "cap-hp-at-precombat-value"
        | "require-hp-threshold"
        | "roll-self-destruct-die"
        | "allow-target-item-attack",
      values: Record<string, unknown> = {},
    ) =>
      effects.push({
        trigger: "passive",
        type: "item-state-rule",
        operation,
        ...values,
        sourceText: clause.text,
      });
    if (/use when you lose a battle/iu.test(clause.text)) {
      stateRule("allow-use-after-combat-loss");
    }
    if (/only one healing item may be used per Battle or Spar/iu.test(clause.text)) {
      stateRule("limit-healing-item-uses", { amount: 1, duration: { unit: "combat", value: 1 } });
    }
    const recoveryRate = /RECOVER rate increases by (\d+)% for (\d+) days/iu.exec(clause.text);
    if (recoveryRate !== null) {
      stateRule("modify-recovery-rate", {
        amount: Number(recoveryRate[1]),
        duration: { unit: "day", value: Number(recoveryRate[2]) },
      });
    }
    const allDiceSides = /your dice gain \+(\d+) sides for the remainder of combat/iu.exec(
      clause.text,
    );
    if (allDiceSides !== null) {
      stateRule("modify-all-roll-sides", {
        amount: Number(allDiceSides[1]),
        duration: { unit: "combat", value: 1 },
      });
    }
    if (/may not use Stat-Boosting items two weeks in a row/iu.test(clause.text)) {
      stateRule("limit-consecutive-stat-boost-weeks", { amount: 1 });
    }
    if (/takes up 1 Skill slot/iu.test(clause.text)) {
      stateRule("modify-skill-slot-capacity", { amount: -1 });
    }
    if (
      /basic Weapon attack during your ACTION PHASE without taking up your turn/iu.test(clause.text)
    ) {
      stateRule("grant-extra-basic-weapon-action");
    }
    if (/no one may interfere in this fight/iu.test(clause.text)) {
      stateRule("prevent-interference");
    }
    if (/change your equipment once mid-week/iu.test(clause.text)) {
      stateRule("permit-equipment-change", { amount: 1, duration: { unit: "week", value: 1 } });
    }
    if (/may not change your equipment during a Battle or Spar/iu.test(clause.text)) {
      stateRule("prevent-equipment-change-during-combat");
    }
    if (/access that planet’s marketplace from your ship/iu.test(clause.text)) {
      stateRule("grant-marketplace-access");
    }
    if (/No longer require one person to pilot the ship/iu.test(clause.text)) {
      stateRule("waive-ship-pilot-requirement");
    }
    const activationKi = /Costs?\s+(\d+)\s+KI Points?/iu.exec(clause.text);
    if (activationKi !== null) stateRule("pay-activation-ki", { amount: Number(activationKi[1]) });
    const currentHeal = /HEAL\s+\((\d+)%\s+Current HP\)/iu.exec(clause.text);
    if (currentHeal !== null) stateRule("heal-current-hp", { amount: Number(currentHeal[1]) });
    const trainingDays = /takes?\s+-(\d+)\s+training day.*minimum of\s+(\d+)/iu.exec(clause.text);
    if (trainingDays !== null) {
      stateRule("reduce-training-days", {
        amount: Number(trainingDays[1]),
        conditionText: `minimum ${trainingDays[2]}`,
      });
    }
    const npcZenni = /After killing an NPC, gain \+(\d+)z/iu.exec(clause.text);
    if (npcZenni !== null) stateRule("grant-zenni-on-npc-kill", { amount: Number(npcZenni[1]) });
    const transformationSides =
      /gain \+(\d+) dice sides to your transformation roll when Sparring/iu.exec(clause.text);
    if (transformationSides !== null)
      stateRule("grant-transformation-roll-sides", { amount: Number(transformationSides[1]) });
    const combatKi = /Once per combat, during your attack phase, you may gain (\d+) ki/iu.exec(
      clause.text,
    );
    if (combatKi !== null) stateRule("grant-ki-per-combat", { amount: Number(combatKi[1]) });
    if (
      /quest that requires 3 or more days and does not require a quest battle/iu.test(clause.text)
    ) {
      stateRule("allow-quest-without-battle", { conditionText: "minimum-days:3" });
    }
    if (/without it taking up an ACCESSORY slot/iu.test(clause.text)) {
      stateRule("permit-accessory-slot-overflow", { amount: 1 });
    }
    if (/may not use this item on the week it is purchased/iu.test(clause.text)) {
      stateRule("restrict-use-in-purchase-week");
    }
    const raceUseLimit = /Majins may eat up to (\d+|two) cookies per match/iu.exec(clause.text);
    if (raceUseLimit !== null) {
      stateRule("limit-race-item-uses", {
        amount: raceUseLimit[1] === "two" ? 2 : Number(raceUseLimit[1]),
        conditionText: "race:majin",
      });
    }
    const raceKi = /If used by a Makyan, gain (\d+) ki/iu.exec(clause.text);
    if (raceKi !== null) {
      stateRule("grant-resource-when-race", {
        amount: Number(raceKi[1]),
        conditionText: "race:makyan;resource:ki",
      });
    }
    if (/opponent loses \(5% Attack's Damage\) HP/iu.test(clause.text)) {
      stateRule("reflect-attack-damage", { amount: 5, conditionText: "successful-energy-attack" });
    }
    if (/pay 1 Ki Point to make that attack UNBLOCKABLE/iu.test(clause.text)) {
      stateRule("make-advanced-attack-unblockable", { amount: 1 });
    }
    const ocarina = /Stop an UNRESTRICTED attack with a result of (\d+) or less/iu.exec(
      clause.text,
    );
    if (ocarina !== null)
      stateRule("stop-low-roll-unrestricted-attack", { amount: Number(ocarina[1]) });
    const setAttackRoll = /attack roll result changes to (\d+)/iu.exec(clause.text);
    if (setAttackRoll !== null)
      stateRule("set-attack-roll-result", { amount: Number(setAttackRoll[1]) });
    if (/reroll your defensive dice/iu.test(clause.text)) stateRule("reroll-defense-dice");
    const taggedCost = /Your (punch|kick)-type attacks cost \+(\d+) KI Point/iu.exec(clause.text);
    if (taggedCost !== null) {
      stateRule("modify-tagged-attack-cost", {
        amount: Number(taggedCost[2]),
        conditionText: `tag:${taggedCost[1]}`,
      });
    }
    const blockCost = /block costs? -(\d+) KI Points? to a minimum of (\d+)/iu.exec(clause.text);
    if (blockCost !== null) {
      stateRule("modify-block-cost", {
        amount: -Number(blockCost[1]),
        conditionText: `minimum:${blockCost[2]}`,
      });
    }
    if (
      /declare.*after.*defen(?:se|ce|sive) roll|use this after.*defen(?:se|ce|sive) roll/iu.test(
        clause.text,
      )
    ) {
      stateRule("declare-after-defense-roll");
    }
    if (/must declare this effect before your roll/iu.test(clause.text))
      stateRule("declare-before-roll");
    const transformationResult =
      /add \+(\d+) to any transformation roll result after your roll/iu.exec(clause.text);
    if (transformationResult !== null) {
      stateRule("modify-transformation-roll-result", { amount: Number(transformationResult[1]) });
    }
    const dailyHeal =
      /heal (?:an additional |\+)?\+?\(?\+?(\d+)% Total HP\)?(?: extra)? per day/iu.exec(
        clause.text,
      );
    if (dailyHeal !== null) stateRule("heal-total-hp-per-day", { amount: Number(dailyHeal[1]) });
    if (/other occupants on the ship can put things into storage/iu.test(clause.text)) {
      stateRule("grant-ship-storage-access");
    }
    if (
      /storage when a ship is successfully raided is automatically given to the invaders/iu.test(
        clause.text,
      )
    ) {
      stateRule("transfer-stored-items-on-raid");
    }
    if (
      /add 1 day onto the travel time of another spaceship currently in transit/iu.test(clause.text)
    ) {
      stateRule("increase-other-ship-travel-time", {
        amount: 1,
        conditionText: "post:1-day/100-wpd",
      });
    }
    const spaceQuest = /space quests take -(\d+) WPD to a minimum of (\d+)/iu.exec(clause.text);
    if (spaceQuest !== null) {
      stateRule("restrict-space-quest-work", {
        amount: -Number(spaceQuest[1]),
        conditionText: `minimum:${spaceQuest[2]}`,
      });
    }
    if (/Once per week, you may challenge someone carrying a Dragon Ball/iu.test(clause.text)) {
      stateRule("challenge-dragon-ball-carrier", {
        amount: 1,
        duration: { unit: "week", value: 1 },
      });
    }
    if (/RESTRICTEDx1 Use after your defensive roll/iu.test(clause.text))
      stateRule("activate-after-defense-roll");
    if (/RESTRICTEDx1 Activate when performing an Advanced Attack/iu.test(clause.text))
      stateRule("activate-on-advanced-attack");
    const firearmStop =
      /results of (\d+) or less from an attack requiring a Firearm are automatically STOPPED/iu.exec(
        clause.text,
      );
    if (firearmStop !== null)
      stateRule("stop-low-firearm-roll", { amount: Number(firearmStop[1]) });
    if (
      /add \+\d+ to the result of (?:you attack roll|an Advanced Attack roll)|add \+\d+ dice sides to an Advanced Attack/iu.test(
        clause.text,
      )
    )
      stateRule("modify-selected-roll");
    if (/deny a challenge that was not initiated/iu.test(clause.text)) stateRule("deny-challenge");
    if (/denied challenger cannot challenge you for the rest of the week/iu.test(clause.text))
      stateRule("apply-challenge-cooldown", { duration: { unit: "week", value: 1 } });
    if (/escape rolls gain -3|escape roll results gain \+3/iu.test(clause.text))
      stateRule("select-escape-roll-modifier", { amount: 3 });
    if (/use an item to regain HP other than RECOVER value/iu.test(clause.text))
      stateRule("heal-after-item-healing", { amount: 10 });
    if (/Stat affected by this item is chosen when purchased/iu.test(clause.text))
      stateRule("select-persistent-stat");
    if (/first time you use an attack to drain an opponent's KI Points/iu.test(clause.text))
      stateRule("increase-single-die-drain", { amount: 1 });
    if (
      /do not lose Meditative Preparation|cannot be prevented from Powering Up/iu.test(clause.text)
    )
      stateRule("protect-combat-state", { duration: { unit: "combat", value: 4 } });
    if (/cannot use this if your opponent used a RESTRICTED attack/iu.test(clause.text))
      stateRule("forbid-defense-reroll-after-restricted-attack");
    const spaceDice = /roll (\d+)d30 (?:at the start of combat|before the start of combat)/iu.exec(
      clause.text,
    );
    if (spaceDice !== null) stateRule("roll-space-combat-dice", { amount: Number(spaceDice[1]) });
    if (/opponent starts at -10% Total HP|start combat at 100% Total HP/iu.test(clause.text))
      stateRule("set-space-combat-starting-hp");
    if (/blocks all of your opponent's copies of that item/iu.test(clause.text))
      stateRule("disable-selected-item-copies");
    if (/may use either two KI gain items or 2 HP gain items/iu.test(clause.text))
      stateRule("limit-space-combat-item-use", { amount: 2 });
    if (
      /dice roll is 14 or higher.*automatically die|dice roll is 13 or below.*malfunctions/iu.test(
        clause.text,
      )
    )
      stateRule("resolve-self-destruct");
    if (/attack roll is 28 or higher.*Magic Carpet is destroyed/iu.test(clause.text))
      stateRule("destroy-item-on-roll-threshold", { amount: 28 });
    if (/Use immediately after a Spar or Battle/iu.test(clause.text))
      stateRule("grant-post-combat-reward");
    if (/declare this after rolling/iu.test(clause.text)) stateRule("declare-after-roll");
    if (/pay \(5% Total HP\) to add \+2 to an Advanced Attack roll/iu.test(clause.text))
      stateRule("pay-hp-for-roll-modifier", { amount: 5 });
    if (/give up your bonus EXP.*gain 3 Ki and \(5% Total Health\)/iu.test(clause.text))
      stateRule("exchange-experience-for-resources", { amount: 5 });
    if (/single dice UNRESTRICTED Physical attack/iu.test(clause.text))
      stateRule("require-unrestricted-single-physical-attack");
    if (/does not apply to multi-dice attacks/iu.test(clause.text))
      stateRule("exclude-multi-die-attacks");
    if (/Activate when using a block/iu.test(clause.text)) stateRule("activate-on-block");
    if (
      /opponent rolls twice on their first advanced attack and uses the lower result/iu.test(
        clause.text,
      )
    )
      stateRule("roll-first-advanced-attack-twice-lower");
    if (
      /end combat with more HP than you had before combat.*lower your HP to your previous amount/iu.test(
        clause.text,
      )
    )
      stateRule("cap-hp-at-precombat-value");
    if (/HP is at \(50% Total HP\) HP or less/iu.test(clause.text))
      stateRule("require-hp-threshold", { amount: 50 });
    if (/Roll 1d30/iu.test(clause.text)) stateRule("roll-self-destruct-die", { amount: 30 });
    if (
      /opponent may choose to perform an energy attack against the Magic Carpet/iu.test(clause.text)
    )
      stateRule("allow-target-item-attack");
    if (/allows inter-galactic travel/iu.test(clause.text)) {
      effects.push({
        trigger: "passive",
        type: "item-grant-travel-permission",
        destination: "another-planet",
        sourceText: clause.text,
      });
    }
    const spaceCombatEffect = (
      role: "challenger" | "challenged" | "either",
      operation:
        | "roll-defense-twice-use-lower"
        | "reroll-single-die-advanced-attack"
        | "act-first"
        | "modify-first-attack-roll"
        | "gain-starting-ki"
        | "increase-first-attack-cost"
        | "set-first-attack-success-threshold"
        | "ignore-opponent-ship-weapon"
        | "ignore-opponent-ship-defense"
        | "grant-extra-basic-attack"
        | "grant-escape-roll-before-combat",
      values: { readonly amount?: number; readonly threshold?: number } = {},
    ) =>
      effects.push({
        trigger: "passive",
        type: "item-space-combat",
        role,
        operation,
        ...values,
        sourceText: clause.text,
      });
    if (
      /opponent rolls defense twice against your first advanced attack and uses the lower result/iu.test(
        clause.text,
      )
    ) {
      spaceCombatEffect("challenger", "roll-defense-twice-use-lower");
    }
    if (
      /reroll a single dice Advanced Attack before your opponent rolls their defense roll/iu.test(
        clause.text,
      )
    ) {
      spaceCombatEffect("challenger", "reroll-single-die-advanced-attack");
    }
    if (/you act first in combat/iu.test(clause.text)) {
      spaceCombatEffect("challenger", "act-first");
    }
    for (const match of clause.text.matchAll(
      /gain \+(\d+) to the result\(s\) of your first attack/giu,
    )) {
      spaceCombatEffect("challenger", "modify-first-attack-roll", { amount: Number(match[1]) });
    }
    for (const match of clause.text.matchAll(/start combat with \+\s*(\d+) Ki/giu)) {
      spaceCombatEffect("challenged", "gain-starting-ki", { amount: Number(match[1]) });
    }
    for (const match of clause.text.matchAll(
      /opponent's first attack costs \+(\d+) Ki Points/giu,
    )) {
      spaceCombatEffect("challenged", "increase-first-attack-cost", { amount: Number(match[1]) });
    }
    for (const match of clause.text.matchAll(
      /first attack roll result\(s\) must be (\d+) or higher to be SUCCESSFUL/giu,
    )) {
      spaceCombatEffect("challenged", "set-first-attack-success-threshold", {
        threshold: Number(match[1]),
      });
    }
    if (/ignore one ship weapon on your opponent's ship/iu.test(clause.text)) {
      spaceCombatEffect("challenged", "ignore-opponent-ship-weapon", { amount: 1 });
    }
    if (/ignore one of your opponent's ship's defenses/iu.test(clause.text)) {
      spaceCombatEffect("challenger", "ignore-opponent-ship-defense", { amount: 1 });
    }
    if (
      /perform a basic attack or Basic Weapon Attack without taking up your turn/iu.test(
        clause.text,
      )
    ) {
      spaceCombatEffect("challenger", "grant-extra-basic-attack", { amount: 1 });
    }
    if (/roll an Escape roll before Space Combat begins/iu.test(clause.text)) {
      spaceCombatEffect("either", "grant-escape-roll-before-combat");
    }
  }
  return effects;
};

const itemRulesFor = (effectText: string, effects: readonly Record<string, unknown>[]) =>
  clausesFor(effectText).map(({ text }) => {
    const family = /marketplace|sell|purchase/iu.test(text)
      ? "marketplace"
      : /quest/iu.test(text)
        ? "quest"
        : /dragon ball.*(?:search|find)|search.*dragon ball/iu.test(text)
          ? "search"
          : /escape roll/iu.test(text)
            ? "escape"
            : /ship|space travel|travel/iu.test(text)
              ? "ship"
              : /battle|combat|attack|defen[cs]e|ki|hp|damage|roll|block|stop/iu.test(text)
                ? "combat"
                : /week|month|day/iu.test(text)
                  ? "weekly"
                  : "other";
    const timing = /once per saga/iu.test(text)
      ? "saga"
      : /once per week|per week|next week/iu.test(text)
        ? "weekly"
        : /marketplace|sell|purchase/iu.test(text)
          ? "marketplace"
          : /quest/iu.test(text)
            ? "quest"
            : /ship|space travel|travel/iu.test(text)
              ? "travel"
              : /before (?:a |entering )?(?:battle|combat)/iu.test(text)
                ? "before-combat"
                : /use when|when you|during (?:your |the )?(?:upkeep|action|end)/iu.test(text)
                  ? "combat-trigger"
                  : /use/iu.test(text)
                    ? "combat-action"
                    : /equipped|wear/iu.test(text)
                      ? "equipped-passive"
                      : "inventory-passive";
    const executable = effects.some((effect) => {
      const sourceText = typeof effect.sourceText === "string" ? effect.sourceText : "";
      return text.includes(sourceText) || sourceText.includes(text);
    });
    return {
      family,
      timing,
      executable,
      ...(executable
        ? {}
        : {
            unresolvedReason:
              family === "other"
                ? "narrative-or-administrator-rule"
                : "requires-dedicated-effect-family",
          }),
      sourceText: text,
    };
  });

const itemNotes = (sourceText: string): readonly string[] =>
  [...sourceText.matchAll(/^Notes?:\s*(.+)$/gmu)].map((match) => match[1]?.trim() ?? "");

const itemHeaderLine = (sourceText: string): string | undefined => {
  const lines = sourceText.split("\n");
  const inventoryIndex = lines.findIndex((line) => /^Inventory Slots\s*:/iu.test(line));
  if (inventoryIndex < 1) return undefined;

  for (let index = inventoryIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index]?.trim() ?? "";
    if (
      candidate.length > 0 &&
      !/^(?:Medicine|Ship Stats:|Space Ships?\s*\/\/\s*Space Ships? Addons)$/iu.test(candidate)
    ) {
      return candidate;
    }
  }

  return undefined;
};

const itemName = (sourceText: string): string | undefined =>
  itemHeaderLine(sourceText)
    ?.replace(/\s*\[[^\]]+\]/gu, "")
    .trim();

const itemPrice = (sourceText: string): number | undefined => {
  const prices = [...(itemHeaderLine(sourceText) ?? "").matchAll(/\[([\d,\s]+)(?:z|Zenni)?\]/giu)]
    .map((match) => Number((match[1] ?? "").replace(/[\s,]/gu, "")))
    .filter(Number.isSafeInteger);
  return prices.at(-1);
};

const itemCategoryFor = (sourcePath: string, sourceText: string, document: string): string => {
  if (sourcePath === "items/equipment.md") {
    return document.indexOf(sourceText) < document.indexOf("## Clothing")
      ? "consumable"
      : "equipment";
  }
  if (sourcePath === "items/ships.md") {
    return document.indexOf(sourceText) < document.indexOf("Basic Gravitron")
      ? "ship"
      : "ship-addon";
  }
  return "special";
};

const itemDefinitions = (
  await Promise.all(
    sourceFiles
      .filter((file) => relative(referenceRoot, file).startsWith(`items${sep}`))
      .map(async (path) => {
        const sourcePath = relative(referenceRoot, path).split(sep).join("/");
        const document = await readFile(path, "utf8");
        return document
          .split(/\r?\n\s*\r?\n/gu)
          .map((sourceText) => sourceText.trim())
          .filter((sourceText) => /^Inventory Slots\s*:/mu.test(sourceText))
          .map((sourceText) => {
            const name = itemName(sourceText);
            const inventoryText = itemFieldValue(sourceText, "Inventory Slots");
            const description = itemFieldValue(sourceText, "Description");
            const effectText = itemFieldValue(sourceText, "Effect");
            if (
              name === undefined ||
              inventoryText === undefined ||
              description === undefined ||
              effectText === undefined
            ) {
              throw new Error(`Incomplete item source in reference/${sourcePath}: ${sourceText}`);
            }

            const inventoryMatch = /^(\d+)(.*)$/u.exec(inventoryText);
            if (inventoryMatch === null) {
              throw new Error(`Invalid item inventory slots for ${name}`);
            }
            const locationText = itemFieldValue(sourceText, "Location");
            const locations =
              locationText === undefined || /^n\/a$/iu.test(locationText)
                ? []
                : locationText.split(",").map((location) => location.trim());
            const equipmentSlot = /\[(UPPER BODY|LOWER BODY|FULL BODY|ACCESSORY)\]/iu.exec(
              `${name}\n${description}`,
            )?.[1];
            const shipSlot = /\[SHIP (WEAPON|DEFENSE)\]/iu.exec(sourceText)?.[1];
            const useMatch = /\b(?:USE|RESTRICTED)\s*x\s*(\d+)/iu.exec(effectText);
            const ship =
              itemCategoryFor(sourcePath, sourceText, document) === "ship"
                ? {
                    ...(itemFieldValue(sourceText, "Max Capacity") === undefined
                      ? {}
                      : {
                          maximumCapacity: Number(
                            itemFieldValue(sourceText, "Max Capacity")?.match(/^\d+/u)?.[0],
                          ),
                        }),
                    ...(itemFieldValue(sourceText, "Weapon Slots") === undefined
                      ? {}
                      : { weaponSlots: Number(itemFieldValue(sourceText, "Weapon Slots")) }),
                    ...(itemFieldValue(sourceText, "Defense Slots") === undefined
                      ? {}
                      : { defenseSlots: Number(itemFieldValue(sourceText, "Defense Slots")) }),
                    ...(itemFieldValue(sourceText, "Travel Time") === undefined
                      ? {}
                      : {
                          travelDays: Number(
                            itemFieldValue(sourceText, "Travel Time")?.match(/^\d+/u)?.[0],
                          ),
                        }),
                    supportSystems: sourceText
                      .split("\n")
                      .filter((line) => line.startsWith("--"))
                      .map((line) => line.slice(2).trim()),
                  }
                : undefined;
            const effects = itemEffectsFor(effectText);

            return {
              id: toItemId(sourcePath, name),
              name,
              category: itemCategoryFor(sourcePath, sourceText, document),
              description,
              effectText,
              effectClauses: clausesFor(effectText),
              rules: itemRulesFor(effectText, effects),
              effects,
              inventorySlots: Number(inventoryMatch[1]),
              ...(inventoryMatch[2].trim().length === 0
                ? {}
                : { inventorySlotCondition: inventoryMatch[2].trim() }),
              ...(itemPrice(sourceText) === undefined ? {} : { price: itemPrice(sourceText) }),
              ...(useMatch === null ? {} : { maxUses: Number(useMatch[1]) }),
              ...(equipmentSlot === undefined
                ? {}
                : { equipmentSlot: equipmentSlot.toLowerCase().replace(/\s+/gu, "-") }),
              ...(shipSlot === undefined ? {} : { shipSlot: shipSlot.toLowerCase() }),
              availability:
                locationText === undefined
                  ? "all"
                  : /^n\/a$/iu.test(locationText)
                    ? "unavailable"
                    : "listed",
              locations,
              notes: itemNotes(sourceText),
              ...(ship === undefined ? {} : { ship }),
              source: { path: `reference/${sourcePath}`, text: sourceText },
            };
          });
      }),
  )
).flat();

const duplicateItemIds = itemDefinitions
  .map(({ id }) => id)
  .filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateItemIds.length > 0) {
  throw new Error(`Duplicate item IDs: ${duplicateItemIds.join(", ")}`);
}

const raceDisplayNames: Readonly<Record<string, string>> = {
  androids: "Android",
  animals: "Animal",
  "bas-jin": "Bas-Jin",
  "bio-androids": "Bio-Android",
  brutii: "Brutii",
  changeling: "Changeling",
  ghost: "Ghost",
  humans: "Human",
  "hybrid-saiyan": "Hybrid-Saiyan",
  "kaizoku-jin": "Kaizoku-Jin",
  konatsian: "Konatsian",
  "maguma-jin": "Maguma-jin",
  majins: "Majin",
  makaioshin: "Makaioshin",
  makyans: "Makyan",
  namek: "Namekian",
  saiyans: "Saiyan",
  shamoians: "Shamoian",
  shikirian: "Shikirian",
  "shin-jins": "Shin-jin",
  "taifuu-jins": "Taifuu-jin",
  timelord: "Timelord",
  tuffles: "Tuffle",
  wizards: "Wizard",
};

const raceKeyForPath = (sourcePath: string): string => {
  const segments = sourcePath.split("/");
  const key = segments.at(-2) ?? "";
  return key === "ghost" ? key : key;
};

const normalizeTransformationSource = (source: string): string =>
  source
    .replace(/\[\/?(?:color|center|list)[^\]]*\]/giu, "")
    .replace(/\[hr\]/giu, "\n")
    .replace(/\[\*\]/gu, "")
    .replace(/\r\n/gu, "\n");

const transformationStarts = (source: string) => [
  ...normalizeTransformationSource(source).matchAll(
    /(?:^|\n)\s*(?:Level|Transformation)\s*(\d+)\s*(?::|—|â€”|-)\s*([^\n]*?)(?=\s*Appearance:|\n|$)/giu,
  ),
];

const transformationDefinitions: unknown[] = [];
const transformationSourceDefinitions: unknown[] = [];
for (const path of sourceFiles.filter((file) =>
  /^transformations?\.md$/iu.test(file.split(sep).at(-1) ?? ""),
)) {
  const sourcePath = relative(referenceRoot, path).split(sep).join("/");
  const source = await readFile(path, "utf8");
  const raceKey = raceKeyForPath(sourcePath);
  const raceId = sourcePath.startsWith("races.transformations/afterlife/")
    ? undefined
    : toRaceId(raceKey);
  const archive = sourcePath === "races.transformations/afterlife/transformations.md";
  const starts = transformationStarts(source);
  transformationSourceDefinitions.push({
    sourcePath: `reference/${sourcePath}`,
    ...(raceId === undefined ? {} : { raceId }),
    status: archive ? "archive" : starts.length === 0 ? "no-mechanics" : "canonical",
    source: { path: `reference/${sourcePath}`, text: source },
  });
  if (archive || raceId === undefined) continue;

  const normalized = normalizeTransformationSource(source);
  const normalizedStarts = transformationStarts(source);
  for (const [index, start] of normalizedStarts.entries()) {
    const startOffset = start.index ?? 0;
    const endOffset = normalizedStarts[index + 1]?.index ?? normalized.length;
    const text = normalized.slice(startOffset, endOffset).trim();
    const tier = Number(start[1]);
    const name = (start[2] ?? `Level ${tier}`).trim() || `Level ${tier}`;
    const stats =
      /Stats:\s*([+-]?\d+)%\s*Power[.,]\s*([+-]?\d+)%\s*(?:HP|Endurance)[.,]\s*([+-]?\d+)%\s*Dexterity/iu.exec(
        text,
      );
    const abilityMatches = [
      ...text.matchAll(
        /\[?(NOVICE|INTERMEDIATE|MASTERED)\]?\s*([^\n-]*)-?\s*([^\n]+(?:\n(?!\[?(?:NOVICE|INTERMEDIATE|MASTERED)\]?)[^\n]+)*)/giu,
      ),
    ];
    const abilityFor = (mastery: string) => {
      const match = abilityMatches.find((candidate) => candidate[1]?.toLowerCase() === mastery);
      const effectText =
        match?.[3]?.trim() ?? "Source does not define this Transformation Ability.";
      const abilityName = match?.[2]?.trim().replace(/[:—-]+$/u, "");
      return {
        ...(abilityName === undefined || abilityName.length === 0 ? {} : { name: abilityName }),
        effectText,
        effectClauses: clausesFor(effectText),
      };
    };
    transformationDefinitions.push({
      id: toTransformationId(raceId, tier, name),
      raceId,
      name,
      tier,
      prerequisites: [],
      statModifiers: {
        powerPercent: Number(stats?.[1] ?? 0),
        hpPercent: Number(stats?.[2] ?? 0),
        dexterityPercent: Number(stats?.[3] ?? 0),
      },
      abilities: {
        novice: abilityFor("novice"),
        intermediate: abilityFor("intermediate"),
        mastered: abilityFor("mastered"),
      },
      ...(itemFieldValue(text, "Appearance") === undefined
        ? {}
        : { appearance: itemFieldValue(text, "Appearance") }),
      notes: itemNotes(text),
      source: { path: `reference/${sourcePath}`, text },
    });
  }
}

const namedRaceEntries = (sourceText: string) =>
  [...sourceText.matchAll(/\[color=[^\]]+\]\s*([^[]+?)\s*\[\/color\]\s*-\s*([^\r\n]+)/giu)].map(
    (match) => ({
      name: match[1]?.trim() ?? "",
      effectText: match[2]?.trim() ?? "",
    }),
  );

const sourceSection = (
  source: string,
  heading: RegExp,
  followingHeadings: readonly RegExp[],
): string => {
  const start = source.search(heading);
  if (start < 0) return "";
  const afterStart = source.slice(start + 1);
  const offsets = followingHeadings
    .map((followingHeading) => afterStart.search(followingHeading))
    .filter((offset) => offset >= 0);
  const end = offsets.length === 0 ? source.length : start + 1 + Math.min(...offsets);
  return source.slice(start, end).trim();
};

const raceDefinitions = await Promise.all(
  sourceFiles
    .filter((file) => relative(referenceRoot, file).split(sep).join("/").endsWith("/race.md"))
    .map(async (path) => {
      const sourcePath = relative(referenceRoot, path).split(sep).join("/");
      const source = await readFile(path, "utf8");
      const raceKey = raceKeyForPath(sourcePath);
      const raceId = toRaceId(raceKey);
      const transformations = transformationDefinitions.filter(
        (definition) => (definition as { raceId: string }).raceId === raceId,
      ) as { id: string }[];
      const racialTraitsText = sourceSection(source, /^.*RACIAL TRAITS.*$/imu, [
        /^.*(?:CLASSES|Classes).*$/imu,
      ]);
      const classesText = sourceSection(source, /^.*(?:CLASSES|Classes).*$/imu, [
        /^\[color=[^\]]+\]Profile.*$/imu,
        /^\[color=[^\]]+\]Transformations.*$/imu,
      ]);
      return {
        id: raceId,
        name: raceDisplayNames[raceKey] ?? raceKey,
        description:
          itemFieldValue(source, "Biography") ?? "Source does not provide a race biography.",
        startingItemNames: [...source.matchAll(/^\[\*\]\s*(.+)$/gmu)].map(
          (match) => match[1]?.trim() ?? "",
        ),
        racialTraitsText,
        classesText,
        racialTraits: namedRaceEntries(racialTraitsText).map((trait) => ({
          id: `race-trait-${raceId.replace(/^race-/u, "")}-${toId(trait.name)}`,
          name: trait.name,
          effectText: trait.effectText,
          effectClauses: clausesFor(trait.effectText),
          source: { path: `reference/${sourcePath}`, text: source },
        })),
        classes: namedRaceEntries(classesText).map((raceClass) => ({
          id: `race-class-${raceId.replace(/^race-/u, "")}-${toId(raceClass.name)}`,
          name: raceClass.name,
          effectText: raceClass.effectText,
          effectClauses: clausesFor(raceClass.effectText),
          source: { path: `reference/${sourcePath}`, text: source },
        })),
        transformationIds: transformations.map((transformation) => transformation.id),
        source: { path: `reference/${sourcePath}`, text: source },
      };
    }),
);

const genericClassSourcePath = "races.transformations/ExtraReferences/genericClassOptions.md";
const genericClassSource = await readFile(join(referenceRoot, genericClassSourcePath), "utf8");
const genericClassDefinitions = [
  ...genericClassSource.matchAll(
    /\[\*\]\s*(.+?)\s*-\s*(.+?)(?=\r?\n\s*\[\*\]|\r?\n\s*\[\/list\]|$)/gsu,
  ),
].map((match) => {
  const name = match[1]?.trim() ?? "";
  const effectText = match[2]?.trim() ?? "";
  return {
    id: `generic-class-${toId(name)}`,
    name,
    effectText,
    effectClauses: clausesFor(effectText),
    source: { path: `reference/${genericClassSourcePath}`, text: genericClassSource },
  };
});

const locationDefinitions = await Promise.all(
  sourceFiles
    .filter((file) => {
      const sourcePath = relative(referenceRoot, file).split(sep).join("/");
      return sourcePath.startsWith("planet/") && !sourcePath.endsWith("locations-and-trainers.md");
    })
    .map(async (path) => {
      const sourcePath = relative(referenceRoot, path).split(sep).join("/");
      const source = await readFile(path, "utf8");
      const segments = sourcePath.replace(/^planet\//u, "").split("/");
      const name = /^#\s+(.+)$/mu.exec(source)?.[1]?.trim() ?? segments.at(-2) ?? "Unknown";
      const isPlanet = segments.length === 2;
      const parentPath = isPlanet ? undefined : `planet/${segments[0]}/${segments[0]}.md`;
      return {
        id: toLocationId(sourcePath),
        name,
        type: isPlanet ? "planet" : "region",
        description: source.replace(/^#\s+.+$/mu, "").trim(),
        ...(parentPath === undefined ? {} : { parentLocationId: toLocationId(parentPath) }),
        source: { path: `reference/${sourcePath}`, text: source },
      };
    }),
);

const trainerCatalogDefinitions = await Promise.all(
  sourceFiles
    .filter((file) =>
      relative(referenceRoot, file).split(sep).join("/").endsWith("locations-and-trainers.md"),
    )
    .map(async (path) => {
      const sourcePath = relative(referenceRoot, path).split(sep).join("/");
      const source = await readFile(path, "utf8");
      const planet = sourcePath.split("/")[1] ?? "";
      return {
        id: `trainer-catalog-${toId(planet)}`,
        locationId: toLocationId(`planet/${planet}/${planet}.md`),
        content: source,
        source: { path: `reference/${sourcePath}`, text: source },
      };
    }),
);

const moveIdByName = new Map(generatedMoveDefinitions.map((move) => [move.name, move.id]));
const itemIdByName = new Map(
  itemDefinitions.map((item) => [item.name.toLocaleLowerCase(), item.id]),
);
const raceIdByName = new Map(
  (raceDefinitions as { readonly id: string; readonly name: string }[]).map((race) => [
    toId(race.name),
    race.id,
  ]),
);
const styleIdByName = new Map(
  ["Akaikaru", "Aoyosumu", "Haokiru", "Kiihakai", "Kurokonwaku", "Midorikatai", "Freestyle"].map(
    (name) => [toId(name), `style-${toId(name)}`],
  ),
);
const trainerDefinitions = trainerCatalogDefinitions.flatMap((catalog) => {
  const lines = catalog.content.replace(/\r\n/gu, "\n").split("\n");
  const trainers: unknown[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(.+?)\s+(?:â€”|—)\s+(.+)$/u.exec(lines[index] ?? "");
    if (heading === null) continue;
    const [styleName, name] = [heading[1]?.trim() ?? "", heading[2]?.trim() ?? ""];
    const moves: string[] = [];
    const unresolvedMoveNames: string[] = [];
    let end = index + 1;
    while (end < lines.length && !/^.+?\s+(?:â€”|—)\s+.+$/u.test(lines[end] ?? "")) {
      const category =
        /^(?:Masteries|Skills|Advanced Attacks|Signature Techniques|Blocks):\s*(.+)$/u.exec(
          lines[end] ?? "",
        );
      if (category !== null) {
        for (const moveName of (category[1] ?? "").split(";").map((value) => value.trim())) {
          if (moveName.length === 0) continue;
          const moveId = moveIdByName.get(moveName);
          if (moveId === undefined) unresolvedMoveNames.push(moveName);
          else moves.push(moveId);
        }
      }
      end += 1;
    }
    const sourceText = lines.slice(index, end).join("\n").trim();
    trainers.push({
      id: `trainer-${toId(catalog.id.replace(/^trainer-catalog-/u, ""))}-${toId(styleName)}-${toId(name)}`,
      locationId: catalog.locationId,
      styleName,
      name,
      moveIds: [...new Set(moves)],
      unresolvedMoveNames,
      source: { path: catalog.source.path, text: sourceText },
    });
    index = end - 1;
  }
  return trainers;
});
const questFieldValue = (sourceText: string, fields: readonly string[]): string | undefined => {
  for (const field of fields) {
    const value = itemFieldValue(sourceText, field);
    if (value !== undefined) return value;
  }
  return undefined;
};

const sourceNumericValue = (sourceText: string) => {
  const baseValue = Number(/^\s*(\d+)/u.exec(sourceText)?.[1]);
  const resolvedValue = Number(/=\s*(\d+)\s*$/u.exec(sourceText)?.[1]);
  return {
    sourceText,
    ...(Number.isFinite(baseValue) ? { baseValue } : {}),
    ...(Number.isFinite(resolvedValue) ? { resolvedValue } : {}),
  };
};

const questRewardsFor = (rewardsText: string): readonly Record<string, unknown>[] => {
  if (rewardsText.trim().length === 0) return [];
  return rewardsText.split(/\s*\/\/\s*/u).map((sourceText) => {
    const reward = sourceText.trim();
    const zenni = /^(\d+)\s*z$/iu.exec(reward);
    if (zenni !== null) {
      return {
        type: "grant-zenni",
        amount: Number(zenni[1]),
        executable: true,
        sourceText: reward,
      };
    }
    const experience = /^(\d+(?:\.\d+)?)x\s+(?:Base )?EXP(?: Gain)?$/iu.exec(reward);
    if (experience !== null) {
      return {
        type: "grant-base-experience-multiplier",
        multiplier: Number(experience[1]),
        executable: true,
        sourceText: reward,
      };
    }
    const itemMatch = /^(.*?)(?:\s*x\s*(\d+))?$/iu.exec(reward);
    const itemName = itemMatch?.[1]?.trim() ?? reward;
    const itemId = itemIdByName.get(itemName.toLocaleLowerCase());
    if (itemId !== undefined) {
      return {
        type: "grant-item",
        itemName,
        quantity: Number(itemMatch?.[2] ?? 1),
        itemId,
        executable: true,
        sourceText: reward,
      };
    }
    const moveId = moveIdByName.get(reward);
    if (moveId !== undefined) {
      return { type: "grant-move", moveName: reward, moveId, executable: true, sourceText: reward };
    }
    if (/Heal all (?:SEVER|BREAK)|restores up to \(100% Total\) HP/iu.test(reward)) {
      return {
        type: "quest-outcome",
        operation: "heal-combat-outcomes",
        executable: true,
        sourceText: reward,
      };
    }
    const trainingDays =
      /next Move Training takes? -(\d+) Day|next move you learn.*takes? -(\d+) day/iu.exec(reward);
    if (trainingDays !== null) {
      return {
        type: "quest-outcome",
        operation: "reduce-move-training-days",
        amount: Number(trainingDays[1] ?? trainingDays[2]),
        executable: true,
        sourceText: reward,
      };
    }
    const transformationRoll = /\+(\d+)d30 to current Trandformation roll/iu.exec(reward);
    if (transformationRoll !== null) {
      return {
        type: "quest-outcome",
        operation: "modify-transformation-roll",
        amount: Number(transformationRoll[1]),
        executable: true,
        sourceText: reward,
      };
    }
    const duration = /next \[DESTROY POTENTIAL\] attempt takes (\d+) days/iu.exec(reward);
    if (duration !== null) {
      return {
        type: "quest-outcome",
        operation: "reduce-quest-duration",
        amount: Number(duration[1]),
        executable: true,
        sourceText: reward,
      };
    }
    if (/another player may swap locations/iu.test(reward)) {
      return {
        type: "quest-outcome",
        operation: "swap-player-locations",
        executable: true,
        sourceText: reward,
      };
    }
    const selectedItem = /^(\d+) Technology item of ([\d,]+)z value or less\.?$/iu.exec(reward);
    if (selectedItem !== null) {
      return {
        type: "quest-outcome",
        operation: "grant-selected-item-by-value",
        amount: Number(selectedItem[2].replace(/,/gu, "")),
        executable: true,
        sourceText: reward,
      };
    }
    const placementExperience = /^\d+(?:st|nd|rd|th) Place:\s*(\d+(?:\.\d+)?)x Base EXP$/iu.exec(
      reward,
    );
    if (placementExperience !== null) {
      return {
        type: "quest-outcome",
        operation: "grant-placement-experience-multiplier",
        amount: Number(placementExperience[1]),
        executable: true,
        sourceText: reward,
      };
    }
    const outcomes = [
      [/change your Afterlife transformation/iu, "swap-afterlife-transformation"],
      [/exchange one Full Body equipment/iu, "exchange-equipment"],
      [/Cross-Galactic Transit System an additional time/iu, "grant-transit-use"],
      [/freestyle Advanced Attack.*now a Styled attack/iu, "convert-move-style"],
      [/next battle.*initiated Destroy Potential/iu, "grant-conditional-battle-stat"],
      [/Fuse two weapons together/iu, "fuse-weapons"],
      [/additional non-mastery move slot/iu, "grant-move-slot"],
      [/Choose a Race.*following week instead of your own/iu, "apply-temporary-race"],
      [
        /quest-ally teach each other one non-custom Freestyle technique/iu,
        "teach-move-between-allies",
      ],
      [/Add a Mastery to your Extra Moves List/iu, "grant-extra-mastery"],
      [/agency performs one non-saga quest/iu, "complete-selected-quest"],
      [/arrive on another planet via space travel, roll 1d10/iu, "roll-on-arrival"],
      [/trade in one item for an equal item of equal worth/iu, "exchange-equal-value-item"],
    ] as const;
    const outcome = outcomes.find(([pattern]) => pattern.test(reward));
    if (outcome !== undefined) {
      return { type: "quest-outcome", operation: outcome[1], executable: true, sourceText: reward };
    }
    const unresolvedReason = /administrator|administration|balanced by|in front of a mod/iu.test(
      reward,
    )
      ? "administrator-mediated"
      : /Coupon\.\s*\[[^\]]+\]$/iu.test(reward) ||
          /^[\p{L}\p{N}'â€™ .-]+(?:\[[^\]]+\])?\.?$/u.test(reward)
        ? "external-catalog-reference"
        : "requires-dedicated-outcome-family";
    return { type: "source-rule", executable: false, unresolvedReason, sourceText: reward };
  });
};

const knownQuestField = (line: string): boolean =>
  /^(?:Description|Quest Description|Requirements|Rewards?|Alternate Reward(?:\(s\))?|Time|Note(?:\(s\))?|Battle(?: Info| Notes)?|Level|Race|Transformation|Racial Traits|HP|Power|Dex(?:terity)?|Move Set|Moves|Mastery|Skills|Advanced Attacks|Signature Techniques|Blocks|Effect|Inventory Slots):/iu.test(
    line,
  );

const npcLabelBeforeLevel = (sourceText: string, levelOffset: number): string | undefined => {
  const lines = sourceText.slice(0, levelOffset).replace(/\r\n/gu, "\n").split("\n");
  for (const line of lines.reverse()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || knownQuestField(trimmed) || trimmed.startsWith("#")) continue;
    const label = trimmed.replace(/^\[\+\]\s*/u, "");
    if (/^[A-Z][\p{L}\p{N}'’.-]*(?:\s+[A-Z][\p{L}\p{N}'’.-]*)*(?:\s+\[[^\]]+\])?$/u.test(label)) {
      return label;
    }
    return undefined;
  }
  return undefined;
};

const nameFromBattleText = (battleText: string): string | undefined => {
  const patterns = [
    /(?:You (?:will )?(?:face|fight)|Battle(?: Info| Notes)?:)\s*(?:the\s+)?([A-Z][\p{L}\p{N}'’ -]+?)(?=\s+(?:is|will|who|has|appears|works|looks|,)|[.!])/u,
    /^([A-Z][\p{L}\p{N}'’ -]+?)\s+is\b/mu,
  ];
  for (const pattern of patterns) {
    const name = pattern.exec(battleText)?.[1]?.trim();
    if (name !== undefined && name.length > 0) return name;
  }
  return undefined;
};

const equipmentNamesFromBattleText = (battleText: string): readonly string[] =>
  [
    ...battleText.matchAll(/(?:wearing|equipped with)\s+(?:an?\s+)?([^.!\n]+)/giu),
    ...battleText.matchAll(/\bhas\s+(?:an?\s+)?([A-Z][^.!\n]+)/gu),
  ]
    .flatMap((match) => (match[1] ?? "").split(/,|\band\b/iu))
    .map((name) => name.trim().replace(/^(?:a|an|the)\s+/iu, ""))
    .filter((name) => name.length > 0);

const legacyNpcDefinitions: unknown[] = [];
const npcDefinitions: unknown[] = [];
const encounterDefinitions: unknown[] = [];
const questDefinitions = await Promise.all(
  sourceFiles
    .filter((file) => relative(referenceRoot, file).split(sep).join("/").startsWith("quests/"))
    .map(async (path) => {
      const sourcePath = relative(referenceRoot, path).split(sep).join("/");
      const source = await readFile(path, "utf8");
      const headings = [...source.matchAll(/^##\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/gmu)];
      const locationKey = sourcePath.replace(/^quests\//u, "").replace(/\.md$/u, "");
      return headings.flatMap((heading, index) => {
        const name = heading[1]?.trim() ?? "";
        const start = heading.index ?? 0;
        const text = source.slice(start, headings[index + 1]?.index ?? source.length).trim();
        if (/\[[^\]]*(?:SKILL|MASTERY|ATTACK|BLOCK)[^\]]*\]/iu.test(heading[0])) return [];
        const requirementsText = itemFieldValue(text, "Requirements") ?? "None";
        const rewardsText = itemFieldValue(text, "Reward") ?? itemFieldValue(text, "Rewards") ?? "";
        const questId = `${toQuestId(sourcePath, name)}-${index + 1}`;
        const battleFields = [...text.matchAll(/^(Battle(?: Info| Notes)?):\s*(.*)$/gmu)];
        const battleText = battleFields.map((match) => match[2]?.trim() ?? "").join("\n");
        const notesText = questFieldValue(text, ["Battle Notes"]);
        const legacyNpcIds: string[] = [];
        const npcIds: string[] = [];
        if (battleText !== undefined) {
          const npcName =
            /^(?:You (?:face|fight)|Battle:)?\s*([^.!]+?)(?:\s+(?:is|isn't|isnâ€™t|who|wearing|,)|[.!]|$)/iu
              .exec(battleText)?.[1]
              ?.trim();
          if (npcName !== undefined && npcName.length > 0) {
            const npcId = `npc-${toId(sourcePath.replace(/^quests\//u, "").replace(/\.md$/u, ""))}-${toId(npcName)}`;
            legacyNpcIds.push(npcId);
            legacyNpcDefinitions.push({
              id: npcId,
              name: npcName,
              moveIds: [],
              description: battleText,
              source: { path: `reference/${sourcePath}`, text },
            });
          }
        }
        const encounterIds: string[] = [];
        if (battleFields.length > 0) {
          const encounterId = `${questId}-encounter-1`;
          const unresolvedCombatantTexts: string[] = [];
          const levelMatches = [...text.matchAll(/^Level:\s*(.+)$/gmu)];
          for (const [combatantIndex, levelMatch] of levelMatches.entries()) {
            const levelOffset = levelMatch.index ?? 0;
            const nextLevelOffset = levelMatches[combatantIndex + 1]?.index ?? text.length;
            const profileText = text.slice(levelOffset, nextLevelOffset).trim();
            const label = npcLabelBeforeLevel(text, levelOffset);
            const styleName = /\[([^\]]+)\]/u.exec(label ?? "")?.[1]?.trim();
            const nameFromLabel = label?.replace(/\s+\[[^\]]+\]\s*$/u, "").trim();
            const npcName = nameFromLabel ?? nameFromBattleText(battleText);
            const raceText = questFieldValue(profileText, ["Race"]);
            const raceName = raceText?.replace(/\s*\[[\s\S]*$/u, "").trim();
            const raceId = raceName === undefined ? undefined : raceIdByName.get(toId(raceName));
            const styleId =
              styleName === undefined ? undefined : styleIdByName.get(toId(styleName));
            const moveText = questFieldValue(profileText, ["Move Set", "Moves"]);
            const moveNames =
              moveText === undefined
                ? []
                : moveText
                    .split(",")
                    .map((moveName) => moveName.trim())
                    .filter((moveName) => moveName.length > 0);
            const moveIds = moveNames.flatMap((moveName) => {
              const moveId = moveIdByName.get(moveName);
              return moveId === undefined ? [] : [moveId];
            });
            const unresolvedMoveNames = moveNames.filter((moveName) => !moveIdByName.has(moveName));
            const combatProfile = {
              levelText: levelMatch[1]?.trim() ?? "",
              ...(questFieldValue(profileText, ["Transformation"]) === undefined
                ? {}
                : { transformationText: questFieldValue(profileText, ["Transformation"]) }),
              ...(questFieldValue(profileText, ["HP"]) === undefined
                ? {}
                : { hitPoints: sourceNumericValue(questFieldValue(profileText, ["HP"]) ?? "") }),
              ...(questFieldValue(profileText, ["Power"]) === undefined
                ? {}
                : { power: sourceNumericValue(questFieldValue(profileText, ["Power"]) ?? "") }),
              ...(questFieldValue(profileText, ["Dexterity", "Dex"]) === undefined
                ? {}
                : {
                    dexterity: sourceNumericValue(
                      questFieldValue(profileText, ["Dexterity", "Dex"]) ?? "",
                    ),
                  }),
              equipmentNames: equipmentNamesFromBattleText(battleText),
              ...(notesText === undefined ? {} : { battleNotes: notesText }),
            };
            if (npcName === undefined) {
              unresolvedCombatantTexts.push(profileText);
              continue;
            }
            const npcId = `npc-${toId(sourcePath.replace(/^quests\//u, "").replace(/\.md$/u, ""))}-${toId(npcName)}-${combatantIndex + 1}`;
            npcIds.push(npcId);
            npcDefinitions.push({
              id: npcId,
              name: npcName,
              ...(raceId === undefined ? {} : { raceId }),
              ...(styleId === undefined ? {} : { styleId }),
              ...(raceName === undefined ? {} : { raceName }),
              ...(styleName === undefined ? {} : { styleName }),
              combatProfile,
              moveIds,
              unresolvedMoveNames,
              description: battleText,
              source: { path: `reference/${sourcePath}`, text: profileText },
            });
          }
          if (levelMatches.length === 0) unresolvedCombatantTexts.push(battleText);
          encounterIds.push(encounterId);
          encounterDefinitions.push({
            id: encounterId,
            questId,
            battleText,
            ...(notesText === undefined ? {} : { notesText }),
            npcIds,
            unresolvedCombatantTexts,
            source: { path: `reference/${sourcePath}`, text },
          });
        }
        return [
          {
            id: questId,
            name,
            description: text,
            prerequisites: [{ type: "source-text", text: requirementsText }],
            requirementsText,
            rewardsText,
            rewards: questRewardsFor(rewardsText),
            ...(battleFields.length === 0 ? {} : { battleText }),
            ...(locationKey === "extras" ? {} : { locationId: `location-${toId(locationKey)}` }),
            npcIds,
            encounterIds,
            source: { path: `reference/${sourcePath}`, text },
          },
        ];
      });
    }),
).then((definitions) => definitions.flat());

const sagaSourcePath = "saga/saga1+2.md";
const sagaSource = await readFile(join(referenceRoot, sagaSourcePath), "utf8");
const sagaStarts = [...sagaSource.matchAll(/^# Saga (\d+): (.+)$/gmu)];
const sagaDefinitions = sagaStarts.map((start, index) => {
  const startOffset = start.index ?? 0;
  const endOffset = sagaStarts[index + 1]?.index ?? sagaSource.length;
  const content = sagaSource.slice(startOffset, endOffset).trim();
  const name = start[2]?.trim() ?? "";
  const number = Number(start[1]);
  const sectionStarts = [...content.matchAll(/^##(#{0,1}) (.+)$/gmu)];
  const sections = sectionStarts.map((section, sectionIndex) => {
    const sectionStartOffset = section.index ?? 0;
    const sectionEndOffset = sectionStarts[sectionIndex + 1]?.index ?? content.length;
    const sectionContent = content.slice(sectionStartOffset, sectionEndOffset).trim();
    const title = section[2]?.trim() ?? "";
    return {
      id: `saga-${number}-${toId(title)}`,
      title,
      level: section[1] === "#" ? 3 : 2,
      content: sectionContent,
      source: { path: `reference/${sagaSourcePath}`, text: sagaSource },
    };
  });
  const overview = sections.find((section) => section.title === "Overview")?.content ?? content;
  return {
    id: `saga-${number}-${toId(name)}`,
    name,
    overview,
    sections,
    source: { path: `reference/${sagaSourcePath}`, text: content },
  };
});

const rulesSourcePath = "rules.md";
const rulesSource = await readFile(join(referenceRoot, rulesSourcePath), "utf8");
const romanNumeralValues: Readonly<Record<string, number>> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};
const ruleSectionStarts = [
  ...rulesSource.matchAll(
    /^(?=[^\n]*\[center\])(?=[^\n]*\[\/center\])[^\n]*?\b([IVX]+)\.\s+([^[]+?)(?=\[)/gmu,
  ),
];
const ruleSectionDefinitions = ruleSectionStarts.map((start, index) => {
  const startOffset = start.index ?? 0;
  const endOffset = ruleSectionStarts[index + 1]?.index ?? rulesSource.length;
  const title = start[2]?.trim() ?? "";
  const number = romanNumeralValues[start[1] ?? ""] ?? 0;
  return {
    id: `rule-section-${number}-${toId(title)}`,
    number,
    title,
    content: rulesSource.slice(startOffset, endOffset).trim(),
    source: { path: `reference/${rulesSourcePath}`, text: rulesSource },
  };
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

const itemOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { ItemDefinition } from "./shared/types.js";',
  "",
  `export const ITEM_DEFINITIONS: readonly ItemDefinition[] = ${JSON.stringify(itemDefinitions, null, 2)};`,
  "",
].join("\n");

await writeFile(itemOutputPath, itemOutput);

const raceOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { GenericClassDefinition, RaceDefinition } from "./shared/types.js";',
  "",
  `export const RACE_DEFINITIONS: readonly RaceDefinition[] = ${JSON.stringify(raceDefinitions, null, 2)};`,
  "",
  `export const GENERIC_CLASS_DEFINITIONS: readonly GenericClassDefinition[] = ${JSON.stringify(genericClassDefinitions, null, 2)};`,
  "",
].join("\n");
await writeFile(raceOutputPath, raceOutput);

const transformationOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { TransformationDefinition, TransformationSourceDefinition } from "./shared/types.js";',
  "",
  `export const TRANSFORMATION_DEFINITIONS: readonly TransformationDefinition[] = ${JSON.stringify(transformationDefinitions, null, 2)};`,
  "",
  `export const TRANSFORMATION_SOURCE_DEFINITIONS: readonly TransformationSourceDefinition[] = ${JSON.stringify(transformationSourceDefinitions, null, 2)};`,
  "",
].join("\n");
await writeFile(transformationOutputPath, transformationOutput);

const locationOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { LocationDefinition, TrainerCatalogDefinition, TrainerDefinition } from "./shared/types.js";',
  "",
  `export const LOCATION_DEFINITIONS: readonly LocationDefinition[] = ${JSON.stringify(locationDefinitions, null, 2)};`,
  "",
  `export const TRAINER_CATALOG_DEFINITIONS: readonly TrainerCatalogDefinition[] = ${JSON.stringify(trainerCatalogDefinitions, null, 2)};`,
  "",
  `export const TRAINER_DEFINITIONS: readonly TrainerDefinition[] = ${JSON.stringify(trainerDefinitions, null, 2)};`,
  "",
].join("\n");
await writeFile(locationOutputPath, locationOutput);

const questOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { NpcDefinition, QuestDefinition, QuestEncounterDefinition } from "./shared/types.js";',
  "",
  `export const QUEST_DEFINITIONS: readonly QuestDefinition[] = ${JSON.stringify(questDefinitions, null, 2)};`,
  "",
  `export const NPC_DEFINITIONS: readonly NpcDefinition[] = ${JSON.stringify(npcDefinitions, null, 2)};`,
  "",
  `export const QUEST_ENCOUNTER_DEFINITIONS: readonly QuestEncounterDefinition[] = ${JSON.stringify(encounterDefinitions, null, 2)};`,
  "",
].join("\n");
await writeFile(questOutputPath, questOutput);

const sagaRuleOutput = [
  "// Generated by scripts/generate-game-data.ts. Do not edit manually.",
  'import type { RuleSectionDefinition, SagaDefinition, SagaSourceDefinition } from "./shared/types.js";',
  "",
  `export const SAGA_SOURCE_DEFINITION: SagaSourceDefinition = ${JSON.stringify(
    {
      id: "saga-outline",
      title: "Dragon Ball: Resurgence — Saga Outline",
      content: sagaSource,
      source: { path: `reference/${sagaSourcePath}`, text: sagaSource },
    },
    null,
    2,
  )};`,
  "",
  `export const SAGA_DEFINITIONS: readonly SagaDefinition[] = ${JSON.stringify(sagaDefinitions, null, 2)};`,
  "",
  `export const RULE_SECTION_DEFINITIONS: readonly RuleSectionDefinition[] = ${JSON.stringify(ruleSectionDefinitions, null, 2)};`,
  "",
].join("\n");
await writeFile(sagaRuleOutputPath, sagaRuleOutput);
