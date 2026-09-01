import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
  type CreateFightInput,
} from "@dragonball-resurgence/combat-engine";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";

import { canonicalHash } from "./canonical.js";
import {
  simulationTemplateSchema,
  type MaterializedSimulationTemplate,
  type SimulationGap,
  type SimulationTemplate,
  type SimulationTf1Overlay,
  type SimulationTemplateResult,
} from "./contracts.js";

const sourceRoot = "balance-testing";
const profileId = SIMULATION_QUALITY_PROFILE.identity.id;
const raceIds: Readonly<Record<string, string>> = {
  Android: "race-androids",
  "Bio-Android": "race-bio-androids",
  Human: "race-humans",
  "Hybrid-Saiyan": "race-hybrid-saiyan",
  Majin: "race-majins",
  Namekian: "race-namek",
  Saiyan: "race-saiyans",
};
const classIds: Readonly<Record<string, string>> = {
  "Power Seeker": "race-class-bio-androids-power-seeker",
  "Warrior Clan": "race-class-namek-warrior-clan",
  "Average in the Extreme": "race-class-humans-average-in-the-extreme",
  Monk: "race-class-humans-monk",
  "The Marvelous (Wo)Man-chine": "race-class-androids-the-marvelous-wo-man-chine",
  "Thin Is In": "race-class-majins-thin-is-in",
  "Mad Science Experiment": "race-class-bio-androids-mad-science-experiment",
  "Elite Class Warrior": "race-class-saiyans-elite-class-warrior",
  "Ruthless Brawler": "race-class-hybrid-saiyan-ruthless-brawler",
  "Fatty, Fatty 2x4": "race-class-majins-fatty-fatty-2x4",
};
const styleIds: Readonly<Record<string, string>> = {
  Akaikaru: "style-akaikaru",
  Aoyosumu: "style-aoyosumu",
  Haokiru: "style-haokiru",
  Kiihakai: "style-kiihakai",
  Kurokonwaku: "style-kurokonwaku",
  Midorikatai: "style-midorikatai",
};
const transformationIds: Readonly<Partial<Record<string, string>>> = {
  "Semi-Perfect": "transformation-bio-androids-1-semi-perfect-form",
  "Giant Form": "transformation-namek-1-giant-form",
  "High Tension": "transformation-humans-1-high-tension",
  "Maintained Malfunction": "transformation-androids-1-maintained-malfunction",
  Evil: "transformation-majins-1-evil-form",
  Oozaru: "transformation-saiyans-1-oozaru",
};

const transformationIdFor = (name: string, raceId: string): string => {
  if (name === "High Tension" && raceId === "race-hybrid-saiyan")
    return "transformation-hybrid-saiyan-1-high-tension";
  if (name === "Oozaru" && raceId === "race-hybrid-saiyan")
    return "transformation-hybrid-saiyan-1-oozaru";
  const transformationId = transformationIds[name];
  if (transformationId === undefined) throw new RangeError(`Unknown TF1 transformation ${name}.`);
  return transformationId;
};

type SourceRow = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  "novice" | "intermediate" | "mastered",
  number,
  number,
  number,
  number,
  number,
  number,
];
const sourceRows: readonly SourceRow[] = [
  [
    "01_akaikaru_adrenaline-rush",
    "Akaikaru",
    "Adrenaline Rush Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Akaikaru",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "02_akaikaru_blazing-speed",
    "Akaikaru",
    "Blazing Speed Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Akaikaru",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "03_akaikaru_berserker",
    "Akaikaru",
    "Berserker Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Akaikaru",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "04_akaikaru_chained",
    "Akaikaru",
    "Chained Mastery",
    "Namekian",
    "Warrior Clan",
    "Giant Form",
    "+1",
    "Akaikaru",
    "novice",
    137,
    76,
    3,
    2,
    3,
    3,
  ],
  [
    "05_akaikaru_intensity",
    "Akaikaru",
    "Intensity Mastery",
    "Human",
    "Average in the Extreme",
    "High Tension",
    "+3",
    "Akaikaru",
    "novice",
    122,
    47,
    5,
    2,
    2,
    4,
  ],
  [
    "06_akaikaru_rage",
    "Akaikaru",
    "Rage Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Akaikaru",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "07_aoyosumu_calming",
    "Aoyosumu",
    "Calming Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Aoyosumu",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "08_aoyosumu_ceasefire",
    "Aoyosumu",
    "Ceasefire Mastery",
    "Majin",
    "Thin Is In",
    "Evil",
    "+3",
    "Aoyosumu",
    "novice",
    125,
    50,
    4,
    2,
    2,
    4,
  ],
  [
    "09_aoyosumu_counterstrike",
    "Aoyosumu",
    "Counterstrike Mastery",
    "Human",
    "Monk",
    "High Tension",
    "+3",
    "Aoyosumu",
    "novice",
    122,
    47,
    5,
    2,
    2,
    4,
  ],
  [
    "10_aoyosumu_leverage",
    "Aoyosumu",
    "Leverage Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Aoyosumu",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "11_aoyosumu_technique",
    "Aoyosumu",
    "Technique Mastery",
    "Bio-Android",
    "Mad Science Experiment",
    "Semi-Perfect",
    "+3",
    "Aoyosumu",
    "novice",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "12_aoyosumu_untouchable",
    "Aoyosumu",
    "Untouchable Mastery",
    "Majin",
    "Thin Is In",
    "Evil",
    "+3",
    "Aoyosumu",
    "novice",
    125,
    50,
    4,
    2,
    2,
    4,
  ],
  [
    "13_haokiru_conservation",
    "Haokiru",
    "Conservation Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Haokiru",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "14_haokiru_channeling",
    "Haokiru",
    "Channeling Mastery",
    "Namekian",
    "Warrior Clan",
    "Giant Form",
    "+3",
    "Haokiru",
    "novice",
    206,
    76,
    2,
    3,
    3,
    2,
  ],
  [
    "15_haokiru_eternal",
    "Haokiru",
    "Eternal Mastery",
    "Majin",
    "Fatty, Fatty 2x4",
    "Evil",
    "-1",
    "Haokiru",
    "novice",
    250,
    50,
    2,
    4,
    2,
    2,
  ],
  [
    "16_haokiru_focused",
    "Haokiru",
    "Focused Mastery",
    "Namekian",
    "Warrior Clan",
    "Giant Form",
    "+3",
    "Haokiru",
    "novice",
    137,
    76,
    3,
    2,
    3,
    3,
  ],
  [
    "17_haokiru_immortal",
    "Haokiru",
    "Immortal Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "-1",
    "Haokiru",
    "novice",
    210,
    52,
    3,
    4,
    2,
    2,
  ],
  [
    "18_haokiru_karmic-chameleon",
    "Haokiru",
    "Karmic Chameleon Mastery",
    "Bio-Android",
    "Mad Science Experiment",
    "Semi-Perfect",
    "+3",
    "Haokiru",
    "novice",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "19_kiihakai_aerial-domination",
    "Kiihakai",
    "Aerial Domination Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Kiihakai",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "20_kiihakai_channeled-chi",
    "Kiihakai",
    "Channeled Chi Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Kiihakai",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "21_kiihakai_destruction",
    "Kiihakai",
    "Destruction Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Kiihakai",
    "novice",
    105,
    78,
    4,
    2,
    3,
    3,
  ],
  [
    "22_kiihakai_fierce-focus",
    "Kiihakai",
    "Fierce Focus Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Kiihakai",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "23_kiihakai_overdrive",
    "Kiihakai",
    "Overdrive Mastery",
    "Bio-Android",
    "Mad Science Experiment",
    "Semi-Perfect",
    "+3",
    "Kiihakai",
    "novice",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "24_kiihakai_power-surge",
    "Kiihakai",
    "Power Surge Mastery",
    "Bio-Android",
    "Mad Science Experiment",
    "Semi-Perfect",
    "+3",
    "Kiihakai",
    "novice",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "25_kurokonwaku_after-image",
    "Kurokonwaku",
    "After-Image Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Kurokonwaku",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "26_kurokonwaku_cancellation",
    "Kurokonwaku",
    "Cancellation Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Kurokonwaku",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "27_kurokonwaku_control",
    "Kurokonwaku",
    "Control Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Kurokonwaku",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "28_kurokonwaku_manipulation",
    "Kurokonwaku",
    "Manipulation Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+3",
    "Kurokonwaku",
    "novice",
    105,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "29_kurokonwaku_mimicry",
    "Kurokonwaku",
    "Mimicry Mastery",
    "Bio-Android",
    "Power Seeker",
    "Semi-Perfect",
    "+3",
    "Kurokonwaku",
    "mastered",
    134,
    52,
    5,
    2,
    2,
    4,
  ],
  [
    "30_kurokonwaku_trickster",
    "Kurokonwaku",
    "Trickster Mastery",
    "Majin",
    "Thin Is In",
    "Evil",
    "+3",
    "Kurokonwaku",
    "novice",
    125,
    50,
    4,
    2,
    2,
    4,
  ],
  [
    "31_midorikatai_absolute-might",
    "Midorikatai",
    "Absolute Might Mastery",
    "Saiyan",
    "Elite Class Warrior",
    "Oozaru",
    "-1",
    "Midorikatai",
    "mastered",
    135,
    120,
    2,
    2,
    4,
    2,
  ],
  [
    "32_midorikatai_bonecrusher",
    "Midorikatai",
    "Bonecrusher Mastery",
    "Hybrid-Saiyan",
    "Ruthless Brawler",
    "High Tension",
    "+1",
    "Midorikatai",
    "novice",
    122,
    73,
    3,
    2,
    3,
    3,
  ],
  [
    "33_midorikatai_critical-mass",
    "Midorikatai",
    "Critical Mass Mastery",
    "Saiyan",
    "Elite Class Warrior",
    "Oozaru",
    "+1",
    "Midorikatai",
    "mastered",
    135,
    90,
    3,
    2,
    3,
    3,
  ],
  [
    "34_midorikatai_domination",
    "Midorikatai",
    "Domination Mastery",
    "Saiyan",
    "Elite Class Warrior",
    "Oozaru",
    "+1",
    "Midorikatai",
    "mastered",
    135,
    90,
    3,
    2,
    3,
    3,
  ],
  [
    "35_midorikatai_flawless-execution",
    "Midorikatai",
    "Flawless Execution Mastery",
    "Android",
    "The Marvelous (Wo)Man-chine",
    "Maintained Malfunction",
    "+1",
    "Midorikatai",
    "novice",
    105,
    78,
    4,
    2,
    3,
    3,
  ],
  [
    "36_midorikatai_overwhelming",
    "Midorikatai",
    "Overwhelming Mastery",
    "Saiyan",
    "Elite Class Warrior",
    "Oozaru",
    "-1",
    "Midorikatai",
    "mastered",
    135,
    120,
    2,
    2,
    4,
    2,
  ],
];

const gapFor = (path: string): SimulationGap => ({
  kind: "loadout",
  reason:
    "TF1 loadout overlay is draft evidence and requires explicit approval before natural-population use.",
  provenance: {
    path,
    text: "TF1 loadout fields require reviewed overlay before materialization.",
    sourceKind: "balance-sheet",
  },
});

const distributedSlice = (
  values: readonly string[],
  count: number,
  offset: number,
): readonly string[] =>
  Array.from(
    { length: Math.min(count, values.length) },
    (_, index) => values[(offset + index) % values.length]!,
  );

const overlayMovesFor = (
  view: CombatMechanicsView,
  styleId: string,
  masteryName: string,
  rowIndex: number,
): readonly string[] => {
  const styled = view.moves.filter((move) => move.styleId === styleId);
  const byCategory = (category: string): readonly string[] =>
    styled
      .filter((move) => move.category === category)
      .map((move) => move.id)
      .sort((left, right) => left.localeCompare(right));
  const mastery = byCategory("mastery");
  if (mastery.length === 0) throw new RangeError(`No mastery move found for ${styleId}.`);
  const selectedMastery =
    styled.find((move) => move.category === "mastery" && move.name === masteryName)?.id ??
    mastery[0]!;
  const skills = byCategory("skill");
  const advancedAttacks = byCategory("advanced-attack");
  const signatures = byCategory("signature");
  const blocks = byCategory("block");
  return [
    selectedMastery,
    ...distributedSlice(skills, 4, rowIndex * 4),
    ...distributedSlice(advancedAttacks, 5, rowIndex * 5),
    ...distributedSlice(signatures, 2, rowIndex * 2),
    ...distributedSlice(blocks, 2, rowIndex * 2),
  ];
};

const overlayFor = (
  templateId: string,
  styleId: string,
  masteryName: string,
  moveIds: readonly string[],
): SimulationTf1Overlay => {
  const generatedFrom = `${templateId}:${styleId}:${masteryName}`;
  const slotLimits = {
    mastery: 1 as const,
    skill: 4 as const,
    advancedAttack: 5 as const,
    signature: 2 as const,
    block: 2 as const,
  };
  const overlayHash = canonicalHash({ generatedFrom, slotLimits, moveIds });
  return {
    schemaVersion: "simulation-tf1-overlay:v1",
    status: "draft",
    generatedFrom,
    slotLimits,
    moveIds: [...moveIds],
    overlayHash,
  };
};

const sourceTemplateFor = (
  row: SourceRow,
  rowIndex: number,
  view: CombatMechanicsView,
): SimulationTemplate => {
  const [
    file,
    style,
    mastery,
    race,
    className,
    transformation,
    dexterityBonus,
    ,
    tfMastery,
    hp,
    power,
    dexterity,
    hpSp,
    powerSp,
    dexteritySp,
  ] = row;
  const path = `${sourceRoot}/${style}/${file}.md`;
  const templateId = `simulation-template:tf1-${file.replaceAll("_", "-")}`;
  const moveIds = overlayMovesFor(view, styleIds[style], mastery, rowIndex);
  return simulationTemplateSchema.parse({
    schemaVersion: "simulation-contracts:v1",
    id: templateId,
    label: mastery,
    kind: "tf1-source",
    checkpointId: "tf1",
    source: { path, text: `${mastery} TF1 source sheet`, sourceKind: "balance-sheet" },
    raceId: raceIds[race],
    classId: classIds[className],
    styleId: styleIds[style],
    mastery,
    specializationPoints: hpSp + powerSp + dexteritySp,
    specializationPointsDistribution: {
      hp: hpSp,
      power: powerSp,
      dexterity: dexteritySp,
      total: hpSp + powerSp + dexteritySp,
    },
    startingKiPolicy: "rules-default",
    transformationName: transformation,
    maximumHitPoints: hp,
    stats: { power, dexterity, dexterityBonus: Number(dexterityBonus) },
    raceTraitIds: [],
    moveIds,
    itemIds: [],
    transformationProfiles: [
      {
        transformationId: transformationIdFor(transformation, raceIds[race]),
        rollSides: tfMastery === "mastered" ? 100 : 20,
        mastery: tfMastery,
      },
    ],
    loadoutOverlay: overlayFor(templateId, styleIds[style], mastery, moveIds),
    gaps: [gapFor(path)],
    aiProfileId: profileId,
  });
};

export const TF1_SIMULATION_TEMPLATES: readonly SimulationTemplate[] = Object.freeze(
  sourceRows.map((row, rowIndex) =>
    sourceTemplateFor(row, rowIndex, CANONICAL_COMBAT_MECHANICS_VIEW),
  ),
);

const syntheticNames = [
  "balanced",
  "high-power",
  "high-dexterity",
  "defensive",
  "burst",
  "status-control",
  "ki-denial",
  "resource-efficient",
  "glass-cannon",
  "sustained-damage",
  "transformation",
  "restricted-use",
] as const;
export type SyntheticArchetype = (typeof syntheticNames)[number];

const movesFor = (
  view: CombatMechanicsView,
  styleId: string,
  archetype: SyntheticArchetype,
): readonly string[] => {
  const styled = view.moves.filter(
    (move) => move.styleId === styleId && move.category !== "mastery",
  );
  const preferred =
    archetype === "transformation" ? styled : styled.filter((move) => move.category !== "block");
  return [...(preferred.length > 0 ? preferred : view.moves)].slice(0, 5).map((move) => move.id);
};

export const createSyntheticArchetypes = (
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): readonly SimulationTemplate[] =>
  Object.freeze(
    syntheticNames.map((name, index) => {
      const styleId =
        styleIds[
          ["Akaikaru", "Aoyosumu", "Haokiru", "Kiihakai", "Kurokonwaku", "Midorikatai"][index % 6]
        ];
      const transformed = name === "transformation";
      const template = {
        schemaVersion: "simulation-contracts:v1" as const,
        id: `simulation-template:synthetic-${name}`,
        label: `${name} synthetic archetype`,
        kind: "synthetic" as const,
        checkpointId: "early",
        source: {
          path: "simulation/synthetic-archetypes",
          text: `Explicit synthetic ${name} fixture`,
          sourceKind: "synthetic" as const,
        },
        raceId: transformed ? "race-saiyans" : "race-humans",
        classId: transformed
          ? "race-class-saiyans-elite-class-warrior"
          : "race-class-humans-average-in-the-extreme",
        styleId,
        mastery: `${name} synthetic mastery`,
        specializationPoints: 8,
        specializationPointsDistribution: { hp: 3, power: 3, dexterity: 2, total: 8 },
        startingKiPolicy: "rules-default",
        maximumHitPoints: name === "glass-cannon" ? 70 : 100,
        stats: {
          power: name === "high-power" || name === "burst" ? 45 : 30,
          dexterity: name === "high-dexterity" ? 25 : 10,
          dexterityBonus: 0,
        },
        raceTraitIds: [],
        moveIds: [...movesFor(view, styleId, name)],
        itemIds: [],
        transformationProfiles: transformed
          ? [
              {
                transformationId: "transformation-saiyans-1-oozaru",
                rollSides: 100,
                mastery: "mastered" as const,
              },
            ]
          : [],
        gaps: [],
        aiProfileId: profileId,
      } satisfies SimulationTemplate;
      return simulationTemplateSchema.parse(template);
    }),
  );

export const ALL_SIMULATION_TEMPLATES = (
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): readonly SimulationTemplate[] =>
  Object.freeze([...TF1_SIMULATION_TEMPLATES, ...createSyntheticArchetypes(view)]);

/** Marks a checked-in draft overlay approved without changing its chosen moves. */
export const approveSimulationTf1Overlay = (
  template: SimulationTemplate,
  approvalReference: string,
): SimulationTemplate => {
  if (template.kind !== "tf1-source" || template.loadoutOverlay === undefined)
    throw new RangeError(`Template ${template.id} does not have a TF1 overlay.`);
  if (approvalReference.trim().length === 0)
    throw new RangeError("TF1 overlay approval requires a reference.");
  const overlay = {
    ...template.loadoutOverlay,
    status: "approved" as const,
    approvalReference,
  };
  return simulationTemplateSchema.parse({
    ...template,
    loadoutOverlay: overlay,
    gaps: [],
  });
};

/** Approves the complete checked-in TF1 overlay set under one review reference. */
export const approveAllSimulationTf1Overlays = (
  approvalReference: string,
): readonly SimulationTemplate[] =>
  Object.freeze(
    TF1_SIMULATION_TEMPLATES.map((template) =>
      approveSimulationTf1Overlay(template, approvalReference),
    ),
  );

const failure = (
  type:
    | "invalid-template"
    | "unknown-reference"
    | "duplicate-reference"
    | "incompatible-loadout"
    | "unsupported-template",
  templateId: string | undefined,
  detail: string,
): SimulationTemplateResult<never> => ({ ok: false, error: { type, templateId, detail } });

/* eslint-disable sonarjs/cognitive-complexity, complexity -- Reference validation is kept together so every template crosses one authoritative boundary. */
export const validateSimulationTemplate = (
  template: unknown,
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): SimulationTemplateResult<SimulationTemplate> => {
  const parsed = simulationTemplateSchema.safeParse(template);
  if (!parsed.success)
    return failure(
      "invalid-template",
      typeof template === "object" && template !== null && "id" in template
        ? String(template.id)
        : undefined,
      parsed.error.message,
    );
  const value = parsed.data;
  if (value.kind === "tf1-source" && value.gaps.length > 0)
    return failure(
      "unsupported-template",
      value.id,
      "TF1 source template is blocked until reviewed loadout overlays are supplied.",
    );
  if (value.kind === "tf1-source" && value.loadoutOverlay?.status !== "approved")
    return failure(
      "unsupported-template",
      value.id,
      "TF1 source template requires an approved loadout overlay before execution.",
    );
  if (value.kind === "tf1-source" && value.loadoutOverlay !== undefined) {
    const overlay = value.loadoutOverlay;
    if (
      canonicalHash({
        generatedFrom: overlay.generatedFrom,
        slotLimits: overlay.slotLimits,
        moveIds: overlay.moveIds,
      }) !== overlay.overlayHash
    )
      return failure("invalid-template", value.id, "TF1 loadout overlay hash is stale.");
    if (canonicalHash(overlay.moveIds) !== canonicalHash(value.moveIds))
      return failure(
        "incompatible-loadout",
        value.id,
        "TF1 loadout overlay move IDs do not match the template loadout.",
      );
    const counts = new Map<string, number>();
    for (const moveId of overlay.moveIds) {
      const category = view.indexes.moves.get(moveId)?.category;
      if (category !== undefined) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const limits: Readonly<Record<string, number>> = {
      mastery: overlay.slotLimits.mastery,
      skill: overlay.slotLimits.skill,
      "advanced-attack": overlay.slotLimits.advancedAttack,
      signature: overlay.slotLimits.signature,
      block: overlay.slotLimits.block,
    };
    for (const [category, count] of counts)
      if (count > (limits[category] ?? 0))
        return failure(
          "incompatible-loadout",
          value.id,
          `TF1 loadout overlay exceeds the ${category} slot limit.`,
        );
  }
  const race = view.indexes.races.get(value.raceId);
  if (race === undefined)
    return failure("unknown-reference", value.id, `Unknown race ${value.raceId}.`);
  const classDefinition = race.classes.find((entry) => entry.id === value.classId);
  if (classDefinition === undefined)
    return failure(
      "incompatible-loadout",
      value.id,
      `Class ${value.classId} does not belong to race ${value.raceId}.`,
    );
  if (!value.moveIds.every((id) => view.indexes.moves.has(id)))
    return failure("unknown-reference", value.id, "Template contains an unknown move reference.");
  if (!value.itemIds.every((id) => view.indexes.items.has(id)))
    return failure("unknown-reference", value.id, "Template contains an unknown item reference.");
  if (!value.raceTraitIds.every((id) => race.racialTraits.some((trait) => trait.id === id)))
    return failure(
      "incompatible-loadout",
      value.id,
      "Template contains a trait from another race.",
    );
  for (const profile of value.transformationProfiles) {
    const transformation = view.indexes.transformations.get(profile.transformationId);
    if (transformation === undefined)
      return failure(
        "unknown-reference",
        value.id,
        `Unknown transformation ${profile.transformationId}.`,
      );
    if (transformation.raceId !== value.raceId)
      return failure(
        "incompatible-loadout",
        value.id,
        "Transformation does not belong to template race.",
      );
  }
  if (
    !value.moveIds.every(
      (id) =>
        view.indexes.moves.get(id)?.styleId === undefined ||
        view.indexes.moves.get(id)?.styleId === value.styleId,
    )
  )
    return failure(
      "incompatible-loadout",
      value.id,
      "Move style is incompatible with declared style.",
    );
  return { ok: true, value };
};
/* eslint-enable sonarjs/cognitive-complexity, complexity */

export const materializeSimulationTemplate = (
  template: unknown,
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): SimulationTemplateResult<MaterializedSimulationTemplate> => {
  const validated = validateSimulationTemplate(template, view);
  if (!validated.ok) return validated;
  const value = validated.value;
  const input: CreateFightInput["combatants"][number] = {
    maximumHitPoints: value.maximumHitPoints,
    stats: value.stats,
    declaredStyleId: value.styleId,
    specializationPoints: value.specializationPoints,
    raceId: value.raceId,
    raceTraitIds: [...value.raceTraitIds],
    classId: value.classId,
    moveIds: [...value.moveIds],
    itemIds: [...value.itemIds],
    transformationProfiles: value.transformationProfiles,
    transformationIds: value.transformationProfiles.map((profile) => profile.transformationId),
  };
  return {
    ok: true,
    value: Object.freeze({
      templateId: value.id,
      input: Object.freeze(input),
      templateHash: canonicalHash(value),
    }),
  };
};
