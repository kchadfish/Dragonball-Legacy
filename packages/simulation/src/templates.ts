import {
  COMBAT_ACTIVE_TRANSFORMATION_RACE_IDS,
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
/** Stable in-repository authority for the corrected TF1 source transcription. */
export const SIMULATION_TF1_SOURCE_AUTHORITY = "repository:balance-testing/tf1:v1" as const;
const profileId = SIMULATION_QUALITY_PROFILE.identity.id;
const combatActiveTransformationRaceIds = new Set<string>(COMBAT_ACTIVE_TRANSFORMATION_RACE_IDS);
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

/**
 * The TF1 sheets are source anchors, so their loadouts are an explicit
 * transcription.  Keep the sheet order here; it is part of the source
 * evidence and must not be reconstructed from catalog order.
 */
const sourceMovesByFile: Readonly<Record<string, readonly string[]>> = {
  "01_akaikaru_adrenaline-rush": [
    "move-akaikaru-adrenaline-rush-mastery",
    "move-akaikaru-swift-reaction",
    "move-akaikaru-speed-demon",
    "move-akaikaru-relentless",
    "move-akaikaru-vehemence",
    "move-akaikaru-chained-strikes",
    "move-akaikaru-torpedo-kick",
    "move-akaikaru-continuous-knee-smash",
    "move-akaikaru-firestorm",
    "move-akaikaru-dexterous-glaive",
    "move-akaikaru-dazzling-gymnastics",
    "move-akaikaru-kip-up-and-over",
    "move-akaikaru-chained-mauler",
    "move-akaikaru-burnout",
  ],
  "02_akaikaru_blazing-speed": [
    "move-akaikaru-blazing-speed-mastery",
    "move-akaikaru-swift-reaction",
    "move-akaikaru-speed-demon",
    "move-akaikaru-relentless",
    "move-akaikaru-vehemence",
    "move-akaikaru-dexterous-glaive",
    "move-akaikaru-shotgun-blast",
    "move-akaikaru-firestorm",
    "move-akaikaru-chained-strikes",
    "move-akaikaru-blitzkrieg",
    "move-akaikaru-dazzling-gymnastics",
    "move-akaikaru-dodging-bullets",
    "move-akaikaru-chained-mauler",
    "move-akaikaru-delta-storm",
  ],
  "03_akaikaru_berserker": [
    "move-akaikaru-berserker-mastery",
    "move-akaikaru-swift-reaction",
    "move-akaikaru-speed-demon",
    "move-akaikaru-relentless",
    "move-akaikaru-vehemence",
    "move-akaikaru-torpedo-kick",
    "move-akaikaru-anger-management",
    "move-akaikaru-sonic-boom",
    "move-akaikaru-machine-gun-kicks",
    "move-akaikaru-hypersonic-knockout",
    "move-akaikaru-gone-in-a-sixtieth-of-a-second",
    "move-akaikaru-kip-up-and-over",
    "move-akaikaru-burnout",
    "move-akaikaru-scorched-earth",
  ],
  "04_akaikaru_chained": [
    "move-akaikaru-chained-mastery",
    "move-akaikaru-swift-reaction",
    "move-akaikaru-speed-demon",
    "move-akaikaru-relentless",
    "move-akaikaru-vehemence",
    "move-akaikaru-chained-strikes",
    "move-akaikaru-shock-fist",
    "move-akaikaru-torpedo-kick",
    "move-akaikaru-back-brain-kick",
    "move-akaikaru-backflip-kick",
    "move-akaikaru-dazzling-gymnastics",
    "move-akaikaru-kip-up-and-over",
    "move-akaikaru-chained-mauler",
    "move-akaikaru-burnout",
  ],
  "05_akaikaru_intensity": [
    "move-akaikaru-intensity-mastery",
    "move-akaikaru-swift-reaction",
    "move-akaikaru-speed-demon",
    "move-akaikaru-relentless",
    "move-akaikaru-vehemence",
    "move-akaikaru-chained-strikes",
    "move-akaikaru-torpedo-kick",
    "move-akaikaru-dexterous-glaive",
    "move-freestyle-aggressive-beatdown",
    "move-freestyle-all-out-triumphant-beam",
    "move-akaikaru-backflip-kick",
    "move-akaikaru-gone-in-a-sixtieth-of-a-second",
    "move-akaikaru-dodging-bullets",
    "move-akaikaru-chained-mauler",
    "move-akaikaru-burnout",
  ],
  "06_akaikaru_rage": [
    "move-akaikaru-rage-mastery",
    "move-akaikaru-swift-reaction",
    "move-akaikaru-speed-demon",
    "move-freestyle-anger-manipulation",
    "move-akaikaru-vehemence",
    "move-akaikaru-firestorm",
    "move-akaikaru-shotgun-blast",
    "move-akaikaru-machine-gun-kicks",
    "move-akaikaru-lord-of-the-flies",
    "move-akaikaru-dexterous-glaive",
    "move-akaikaru-dazzling-gymnastics",
    "move-akaikaru-dodging-bullets",
    "move-akaikaru-great-finale",
    "move-akaikaru-delta-storm",
  ],
  "07_aoyosumu_calming": [
    "move-aoyosumu-calming-mastery",
    "move-aoyosumu-close-shave",
    "move-aoyosumu-inner-peace",
    "move-aoyosumu-state-of-zen",
    "move-aoyosumu-quiet-preparation",
    "move-aoyosumu-return-fire",
    "move-aoyosumu-tranquil-strike",
    "move-aoyosumu-weeping-willow",
    "move-aoyosumu-zen-explosion",
    "move-aoyosumu-breathtaker",
    "move-aoyosumu-defiant-stance",
    "move-aoyosumu-blast-shield",
    "move-aoyosumu-creeping-death",
    "move-aoyosumu-the-secret-of-the-universe",
  ],
  "08_aoyosumu_ceasefire": [
    "move-aoyosumu-ceasefire-mastery",
    "move-aoyosumu-close-shave",
    "move-aoyosumu-state-of-zen",
    "move-aoyosumu-the-untroubled-mind",
    "move-aoyosumu-reversal-of-fortune",
    "move-aoyosumu-heart-punch",
    "move-aoyosumu-return-fire",
    "move-aoyosumu-tranquil-strike",
    "move-aoyosumu-weeping-willow",
    "move-aoyosumu-zen-explosion",
    "move-aoyosumu-defiant-stance",
    "move-aoyosumu-impenetrable-defense",
    "move-aoyosumu-epitaph-to-war",
    "move-aoyosumu-the-secret-of-the-universe",
  ],
  "09_aoyosumu_counterstrike": [
    "move-aoyosumu-counterstrike-mastery",
    "move-aoyosumu-quiet-preparation",
    "move-aoyosumu-reversal-of-fortune",
    "move-aoyosumu-state-of-zen",
    "move-aoyosumu-inner-peace",
    "move-aoyosumu-heart-punch",
    "move-aoyosumu-return-fire",
    "move-aoyosumu-trapped-strikes",
    "move-aoyosumu-wind-shove",
    "move-aoyosumu-tranquil-strike",
    "move-aoyosumu-breathtaker",
    "move-aoyosumu-defiant-stance",
    "move-aoyosumu-somersault-roll",
    "move-aoyosumu-heavenly-execution",
    "move-aoyosumu-creeping-death",
  ],
  "10_aoyosumu_leverage": [
    "move-aoyosumu-leverage-mastery",
    "move-aoyosumu-close-shave",
    "move-aoyosumu-inner-peace",
    "move-aoyosumu-stoicism",
    "move-aoyosumu-state-of-zen",
    "move-aoyosumu-return-fire",
    "move-aoyosumu-weeping-willow",
    "move-aoyosumu-breathtaker",
    "move-aoyosumu-trapped-strikes",
    "move-aoyosumu-zen-explosion",
    "move-aoyosumu-defiant-stance",
    "move-aoyosumu-blast-shield",
    "move-aoyosumu-creeping-death",
    "move-aoyosumu-the-secret-of-the-universe",
  ],
  "11_aoyosumu_technique": [
    "move-aoyosumu-technique-mastery",
    "move-aoyosumu-the-untroubled-mind",
    "move-aoyosumu-reversal-of-fortune",
    "move-aoyosumu-stoicism",
    "move-aoyosumu-calming-the-battlefield",
    "move-aoyosumu-quiet-preparation",
    "move-aoyosumu-heart-punch",
    "move-aoyosumu-return-fire",
    "move-aoyosumu-swift-neck-chop",
    "move-aoyosumu-tranquil-strike",
    "move-aoyosumu-zen-explosion",
    "move-aoyosumu-defiant-stance",
    "move-aoyosumu-blast-shield",
    "move-aoyosumu-epitaph-to-war",
    "move-aoyosumu-the-secret-of-the-universe",
  ],
  "12_aoyosumu_untouchable": [
    "move-aoyosumu-untouchable-mastery",
    "move-aoyosumu-close-shave",
    "move-aoyosumu-inner-peace",
    "move-aoyosumu-state-of-zen",
    "move-aoyosumu-stoicism",
    "move-aoyosumu-return-fire",
    "move-aoyosumu-weeping-willow",
    "move-aoyosumu-breathtaker",
    "move-aoyosumu-zen-explosion",
    "move-aoyosumu-tranquil-strike",
    "move-aoyosumu-defiant-stance",
    "move-aoyosumu-impenetrable-defense",
    "move-aoyosumu-creeping-death",
    "move-aoyosumu-serenity-explosion",
  ],
  "13_haokiru_conservation": [
    "move-haokiru-conservation-mastery",
    "move-haokiru-creationist",
    "move-haokiru-muscle-infusion",
    "move-haokiru-energy-absorption",
    "move-haokiru-survival-instinct",
    "move-haokiru-eye-laser-assault",
    "move-haokiru-handstand-kick",
    "move-haokiru-phoenix-ash-blast",
    "move-haokiru-enervating-cannon",
    "move-haokiru-spirit-walk",
    "move-haokiru-halting-stance",
    "move-haokiru-neutralization",
    "move-haokiru-miracle-wave",
    "move-haokiru-soul-breaker",
  ],
  "14_haokiru_channeling": [
    "move-haokiru-channeling-mastery",
    "move-haokiru-creationist",
    "move-haokiru-willing-sacrifice",
    "move-haokiru-muscle-infusion",
    "move-haokiru-spirited-effort",
    "move-haokiru-tornado-uppercut",
    "move-haokiru-focused-spirit-cutter",
    "move-haokiru-spirit-walk",
    "move-haokiru-ki-lance",
    "move-haokiru-dragon-beam",
    "move-haokiru-display-of-endurance",
    "move-haokiru-miraculous-recovery",
    "move-haokiru-apocalyptic-chaos",
    "move-haokiru-soul-breaker",
  ],
  "15_haokiru_eternal": [
    "move-haokiru-eternal-mastery",
    "move-haokiru-survival-instinct",
    "move-haokiru-muscle-infusion",
    "move-haokiru-healing-ray",
    "move-haokiru-reserves",
    "move-haokiru-prolific-blast",
    "move-haokiru-dragon-dust",
    "move-haokiru-dragon-beam",
    "move-haokiru-double-arm-cannon",
    "move-haokiru-indestructible-wave",
    "move-haokiru-display-of-endurance",
    "move-haokiru-neutralization",
    "move-haokiru-rapture",
    "move-haokiru-miracle-wave",
  ],
  "16_haokiru_focused": [
    "move-haokiru-focused-mastery",
    "move-haokiru-creationist",
    "move-haokiru-energy-absorption",
    "move-haokiru-muscle-infusion",
    "move-haokiru-healing-ray",
    "move-haokiru-prolific-blast",
    "move-haokiru-phantom-barrage",
    "move-haokiru-dragon-swipes",
    "move-haokiru-immortal-burst",
    "move-haokiru-dragon-fire",
    "move-haokiru-halting-stance",
    "move-haokiru-neutralization",
    "move-haokiru-miracle-wave",
    "move-haokiru-rapture",
  ],
  "17_haokiru_immortal": [
    "move-haokiru-immortal-mastery",
    "move-haokiru-survival-instinct",
    "move-haokiru-muscle-infusion",
    "move-haokiru-advanced-behavior",
    "move-haokiru-healing-ray",
    "move-haokiru-five-finger-shot",
    "move-haokiru-focused-spirit-cutter",
    "move-haokiru-vengeance-wave",
    "move-haokiru-indestructible-wave",
    "move-haokiru-immortal-burst",
    "move-haokiru-display-of-endurance",
    "move-haokiru-halting-stance",
    "move-haokiru-soul-breaker",
    "move-haokiru-rapture",
  ],
  "18_haokiru_karmic-chameleon": [
    "move-haokiru-karmic-chameleon-mastery",
    "move-haokiru-mind-reading",
    "move-haokiru-creationist",
    "move-haokiru-muscle-infusion",
    "move-haokiru-survival-instinct",
    "move-haokiru-five-finger-shot",
    "move-haokiru-spirit-walk",
    "move-haokiru-ki-lance",
    "move-haokiru-vengeance-wave",
    "move-haokiru-eye-laser-assault",
    "move-haokiru-display-of-endurance",
    "move-haokiru-halting-stance",
    "move-haokiru-soul-breaker",
    "move-haokiru-miracle-wave",
  ],
  "19_kiihakai_aerial-domination": [
    "move-kiihakai-aerial-domination-mastery",
    "move-kiihakai-eagle-eye",
    "move-kiihakai-power-boost",
    "move-kiihakai-energy-gathering",
    "move-freestyle-energy-redirection",
    "move-kiihakai-aerial-beam",
    "move-kiihakai-focused-chi-barrage",
    "move-kiihakai-heavy-jolt",
    "move-kiihakai-orange-burst",
    "move-kiihakai-heat-seeking-blast",
    "move-kiihakai-beam-redirection",
    "move-kiihakai-negative-outburst",
    "move-kiihakai-shooting-star",
    "move-kiihakai-thunder-ball",
  ],
  "20_kiihakai_channeled-chi": [
    "move-kiihakai-channeled-chi-mastery",
    "move-kiihakai-protective-aura",
    "move-kiihakai-energy-gathering",
    "move-kiihakai-ki-shield",
    "move-kiihakai-overload",
    "move-kiihakai-synergy",
    "move-kiihakai-focused-chi-barrage",
    "move-kiihakai-kinetic-outburst",
    "move-kiihakai-triple-torpedo",
    "move-kiihakai-twisting-beam",
    "move-kiihakai-devastating-blade",
    "move-kiihakai-ki-fist-block",
    "move-kiihakai-beam-redirection",
    "move-kiihakai-thunder-ball",
    "move-kiihakai-rollback-barrage",
  ],
  "21_kiihakai_destruction": [
    "move-kiihakai-destruction-mastery",
    "move-kiihakai-aura-burst",
    "move-kiihakai-energy-gathering",
    "move-kiihakai-power-boost",
    "move-kiihakai-synergy",
    "move-kiihakai-fade-attack",
    "move-kiihakai-heat-seeking-blast",
    "move-kiihakai-devastating-blade",
    "move-kiihakai-orange-burst",
    "move-kiihakai-focused-chi-barrage",
    "move-kiihakai-beam-redirection",
    "move-kiihakai-negative-outburst",
    "move-kiihakai-the-rising-sun",
    "move-kiihakai-the-heartstopper",
  ],
  "22_kiihakai_fierce-focus": [
    "move-kiihakai-fierce-focus-mastery",
    "move-kiihakai-protective-aura",
    "move-kiihakai-ki-shield",
    "move-kiihakai-energy-gathering",
    "move-kiihakai-focus-breaker",
    "move-kiihakai-focused-chi-barrage",
    "move-kiihakai-triple-torpedo",
    "move-kiihakai-kinetic-outburst",
    "move-kiihakai-devastating-blade",
    "move-kiihakai-orange-burst",
    "move-kiihakai-ki-fist-block",
    "move-kiihakai-beam-redirection",
    "move-kiihakai-thunder-ball",
    "move-kiihakai-rollback-barrage",
  ],
  "23_kiihakai_overdrive": [
    "move-kiihakai-overdrive-mastery",
    "move-kiihakai-energy-gathering",
    "move-kiihakai-ki-barbs",
    "move-kiihakai-synergy",
    "move-kiihakai-power-boost",
    "move-kiihakai-overdrive-blast",
    "move-kiihakai-stray-bullet",
    "move-kiihakai-orange-burst",
    "move-kiihakai-heat-seeking-blast",
    "move-kiihakai-devastating-blade",
    "move-kiihakai-beam-redirection",
    "move-kiihakai-negative-outburst",
    "move-kiihakai-raindance",
    "move-kiihakai-the-rising-sun",
  ],
  "24_kiihakai_power-surge": [
    "move-kiihakai-power-surge-mastery",
    "move-kiihakai-energy-gathering",
    "move-kiihakai-synergy",
    "move-kiihakai-power-boost",
    "move-kiihakai-aura-burst",
    "move-kiihakai-orange-burst",
    "move-kiihakai-orbital-cannon",
    "move-kiihakai-sledgehammer",
    "move-kiihakai-devastating-blade",
    "move-kiihakai-heat-seeking-blast",
    "move-kiihakai-beam-redirection",
    "move-kiihakai-negative-outburst",
    "move-kiihakai-the-rising-sun",
    "move-kiihakai-thunder-ball",
  ],
  "25_kurokonwaku_after-image": [
    "move-kurokonwaku-after-image-mastery",
    "move-kurokonwaku-childish-taunt",
    "move-kurokonwaku-shadow-stalker",
    "move-kurokonwaku-second-chance",
    "move-kurokonwaku-ki-trap",
    "move-kurokonwaku-firebreath",
    "move-kurokonwaku-cannonball",
    "move-kurokonwaku-burrowing-beam",
    "move-kurokonwaku-proximity-blast",
    "move-kurokonwaku-tesla-coil",
    "move-kurokonwaku-mirage",
    "move-kurokonwaku-sand-in-the-eyes",
    "move-kurokonwaku-purple-people-skewer",
    "move-kurokonwaku-fade-to-black",
  ],
  "26_kurokonwaku_cancellation": [
    "move-kurokonwaku-cancellation-mastery",
    "move-kurokonwaku-second-chance",
    "move-kurokonwaku-killer-gaze",
    "move-kurokonwaku-shadow-stalker",
    "move-kurokonwaku-flashback",
    "move-kurokonwaku-firebreath",
    "move-kurokonwaku-darkness-buster",
    "move-kurokonwaku-strategic-breakdown",
    "move-kurokonwaku-proximity-blast",
    "move-kurokonwaku-sixty-second-meltdown",
    "move-kurokonwaku-mirage",
    "move-kurokonwaku-aerial-maneuvers",
    "move-kurokonwaku-dimension-scream",
    "move-kurokonwaku-dance-with-the-devil",
  ],
  "27_kurokonwaku_control": [
    "move-kurokonwaku-control-mastery",
    "move-kurokonwaku-puppet-master",
    "move-kurokonwaku-second-chance",
    "move-kurokonwaku-shadow-stalker",
    "move-kurokonwaku-ki-trap",
    "move-kurokonwaku-darkness-choke",
    "move-kurokonwaku-ear-piercer",
    "move-kurokonwaku-darkness-buster",
    "move-kurokonwaku-squeezebox",
    "move-kurokonwaku-sweet-dreams",
    "move-kurokonwaku-mirage",
    "move-kurokonwaku-sand-in-the-eyes",
    "move-kurokonwaku-dimension-scream",
    "move-kurokonwaku-fade-to-black",
  ],
  "28_kurokonwaku_manipulation": [
    "move-kurokonwaku-manipulation-mastery",
    "move-kurokonwaku-flashback",
    "move-kurokonwaku-second-chance",
    "move-kurokonwaku-living-voodoo",
    "move-kurokonwaku-killer-gaze",
    "move-kurokonwaku-shockwave",
    "move-kurokonwaku-empty-beam",
    "move-kurokonwaku-tesla-coil",
    "move-kurokonwaku-shinobi-slash",
    "move-kurokonwaku-energy-lob",
    "move-kurokonwaku-mirage",
    "move-kurokonwaku-smokescreen",
    "move-kurokonwaku-black-hole-slam",
    "move-kurokonwaku-dimension-scream",
  ],
  "29_kurokonwaku_mimicry": [
    "move-kurokonwaku-mimicry-mastery",
    "move-kurokonwaku-flashback",
    "move-kurokonwaku-second-chance",
    "move-kurokonwaku-shadow-stalker",
    "move-kurokonwaku-killer-gaze",
    "move-kurokonwaku-ear-piercer",
    "move-kurokonwaku-firebreath",
    "move-kurokonwaku-proximity-blast",
    "move-kurokonwaku-energy-lob",
    "move-kurokonwaku-sixty-second-meltdown",
    "move-kurokonwaku-mirage",
    "move-kurokonwaku-aerial-maneuvers",
    "move-kurokonwaku-fade-to-black",
    "move-kurokonwaku-dimension-scream",
  ],
  "30_kurokonwaku_trickster": [
    "move-kurokonwaku-trickster-mastery",
    "move-kurokonwaku-second-chance",
    "move-kurokonwaku-killer-gaze",
    "move-kurokonwaku-puppet-master",
    "move-kurokonwaku-shadow-stalker",
    "move-kurokonwaku-firebreath",
    "move-kurokonwaku-darkness-choke",
    "move-kurokonwaku-ear-piercer",
    "move-kurokonwaku-cannonball",
    "move-kurokonwaku-proximity-blast",
    "move-kurokonwaku-mirage",
    "move-kurokonwaku-sand-in-the-eyes",
    "move-kurokonwaku-fade-to-black",
    "move-kurokonwaku-purple-people-skewer",
  ],
  "31_midorikatai_absolute-might": [
    "move-midorikatai-absolute-might-mastery",
    "move-midorikatai-energy-gorged",
    "move-midorikatai-war-cry",
    "move-midorikatai-against-the-odds",
    "move-midorikatai-sucker-punch",
    "move-midorikatai-gut-punch",
    "move-midorikatai-knee-stomp",
    "move-midorikatai-cobra-clutch-drop",
    "move-midorikatai-power-drill",
    "move-midorikatai-back-suplex",
    "move-midorikatai-spinebuster",
    "move-midorikatai-built-like-a-mountain",
    "move-midorikatai-energy-breaker",
    "move-midorikatai-monster-mash",
    "move-midorikatai-doomsday-device",
  ],
  "32_midorikatai_bonecrusher": [
    "move-midorikatai-bonecrusher-mastery",
    "move-midorikatai-energy-gorged",
    "move-midorikatai-war-cry",
    "move-midorikatai-not-over-till-it-s-over",
    "move-midorikatai-sucker-punch",
    "move-midorikatai-breaker-breaker",
    "move-midorikatai-kneebreaker",
    "move-midorikatai-armbreaker",
    "move-midorikatai-finger-cuffs",
    "move-midorikatai-jawbreaker",
    "move-midorikatai-spinebuster",
    "move-midorikatai-built-like-a-mountain",
    "move-midorikatai-energy-breaker",
    "move-midorikatai-doomsday-device",
    "move-midorikatai-falling-star-charge",
  ],
  "33_midorikatai_critical-mass": [
    "move-midorikatai-critical-mass-mastery",
    "move-midorikatai-energy-gorged",
    "move-midorikatai-war-cry",
    "move-midorikatai-not-over-till-it-s-over",
    "move-midorikatai-against-the-odds",
    "move-midorikatai-gut-punch",
    "move-midorikatai-knee-stomp",
    "move-midorikatai-cobra-clutch-drop",
    "move-midorikatai-power-drill",
    "move-midorikatai-armbreaker",
    "move-midorikatai-built-like-a-mountain",
    "move-midorikatai-leg-vice",
    "move-midorikatai-galactic-punisher",
    "move-midorikatai-dim-mak",
  ],
  "34_midorikatai_domination": [
    "move-midorikatai-domination-mastery",
    "move-midorikatai-energy-gorged",
    "move-midorikatai-war-cry",
    "move-midorikatai-fall-7-times-get-up-8",
    "move-midorikatai-against-the-odds",
    "move-midorikatai-back-suplex",
    "move-midorikatai-gut-punch",
    "move-midorikatai-palm-crusher",
    "move-midorikatai-power-drill",
    "move-midorikatai-cobra-clutch-drop",
    "move-midorikatai-built-like-a-mountain",
    "move-midorikatai-leg-vice",
    "move-midorikatai-dim-mak",
    "move-midorikatai-monster-mash",
  ],
  "35_midorikatai_flawless-execution": [
    "move-midorikatai-flawless-execution-mastery",
    "move-midorikatai-energy-gorged",
    "move-midorikatai-war-cry",
    "move-midorikatai-against-the-odds",
    "move-midorikatai-not-over-till-it-s-over",
    "move-midorikatai-knee-stomp",
    "move-midorikatai-cobra-clutch-drop",
    "move-midorikatai-power-drill",
    "move-midorikatai-megaton-cannon",
    "move-midorikatai-back-suplex",
    "move-midorikatai-built-like-a-mountain",
    "move-midorikatai-energy-breaker",
    "move-midorikatai-galactic-punisher",
    "move-midorikatai-doomsday-device",
  ],
  "36_midorikatai_overwhelming": [
    "move-midorikatai-overwhelming-mastery",
    "move-midorikatai-energy-gorged",
    "move-midorikatai-war-cry",
    "move-midorikatai-not-over-till-it-s-over",
    "move-midorikatai-against-the-odds",
    "move-midorikatai-cobra-clutch-drop",
    "move-midorikatai-football-tackle",
    "move-midorikatai-palm-crusher",
    "move-midorikatai-power-drill",
    "move-midorikatai-spinebuster",
    "move-midorikatai-built-like-a-mountain",
    "move-midorikatai-leg-vice",
    "move-midorikatai-monster-mash",
    "move-midorikatai-dim-mak",
  ],
};

const sourceItemsByRace: Readonly<Record<string, readonly string[]>> = {
  "race-bio-androids": ["item-equipment-nanomachine", "item-technology-self-destruct-device"],
  "race-namek": ["item-equipment-namekian-uniform", "item-equipment-senzu-root"],
  "race-humans": ["item-equipment-cargo-pants", "item-equipment-hercule-drink-dx"],
  "race-androids": ["item-equipment-normal-red-ribbon-vest", "item-technology-spare-parts"],
  "race-majins": ["item-equipment-basic-mystic-pants", "item-equipment-majin-cookies"],
  "race-saiyans": ["item-equipment-speedo", "item-ships-space-pod"],
  "race-hybrid-saiyan": [
    "item-equipment-normal-capsule-corp-fighting-jacket",
    "item-equipment-first-aid-kit",
  ],
};

const sourceTraitsByRaceAndClass: Readonly<Record<string, readonly string[]>> = {
  "race-bio-androids:race-class-bio-androids-power-seeker": [
    "race-trait-bio-androids-regeneration",
    "race-trait-saiyans-saiyan-might",
  ],
  "race-bio-androids:race-class-bio-androids-mad-science-experiment": [
    "race-trait-bio-androids-regeneration",
    "race-trait-saiyans-saiyan-might",
    "race-trait-namek-meditative-preparation",
  ],
  "race-namek:race-class-namek-warrior-clan": [
    "race-trait-namek-meditative-preparation",
    "race-trait-namek-regeneration",
  ],
  "race-humans:race-class-humans-average-in-the-extreme": [
    "race-trait-humans-where-there-s-life-there-s-hope",
    "race-trait-humans-mentorship",
  ],
  "race-humans:race-class-humans-monk": [
    "race-trait-humans-where-there-s-life-there-s-hope",
    "race-trait-humans-mentorship",
  ],
  "race-androids:race-class-androids-the-marvelous-wo-man-chine": [
    "race-trait-androids-android-signature",
    "race-trait-androids-power-core",
  ],
  "race-majins:race-class-majins-thin-is-in": [
    "race-trait-majins-bubblegum-flesh",
    "race-trait-majins-regeneration",
  ],
  "race-majins:race-class-majins-fatty-fatty-2x4": [
    "race-trait-majins-bubblegum-flesh",
    "race-trait-majins-regeneration",
  ],
  "race-saiyans:race-class-saiyans-elite-class-warrior": [
    "race-trait-saiyans-saiyan-might",
    "race-trait-saiyans-zenkai-power",
  ],
  "race-hybrid-saiyan:race-class-hybrid-saiyan-ruthless-brawler": [
    "race-trait-hybrid-saiyan-zenkai-power",
    "race-trait-hybrid-saiyan-where-there-s-life-there-s-hope",
  ],
};

const sixStartingKiFiles = new Set([
  "04_akaikaru_chained",
  "11_aoyosumu_technique",
  "14_haokiru_channeling",
  "16_haokiru_focused",
  "18_haokiru_karmic-chameleon",
  "23_kiihakai_overdrive",
  "24_kiihakai_power-surge",
]);
const twelveMaximumKiFiles = new Set([
  "07_aoyosumu_calming",
  "10_aoyosumu_leverage",
  "13_haokiru_conservation",
  "17_haokiru_immortal",
  "20_kiihakai_channeled-chi",
  "21_kiihakai_destruction",
  "22_kiihakai_fierce-focus",
  "26_kurokonwaku_cancellation",
  "27_kurokonwaku_control",
  "28_kurokonwaku_manipulation",
  "35_midorikatai_flawless-execution",
]);
const energySpecializationFiles = new Set([
  "06_akaikaru_rage",
  "13_haokiru_conservation",
  "15_haokiru_eternal",
  "16_haokiru_focused",
  "17_haokiru_immortal",
  "18_haokiru_karmic-chameleon",
  "19_kiihakai_aerial-domination",
  "20_kiihakai_channeled-chi",
  "21_kiihakai_destruction",
  "22_kiihakai_fierce-focus",
  "23_kiihakai_overdrive",
  "24_kiihakai_power-surge",
  "25_kurokonwaku_after-image",
  "26_kurokonwaku_cancellation",
  "27_kurokonwaku_control",
  "28_kurokonwaku_manipulation",
  "29_kurokonwaku_mimicry",
  "30_kurokonwaku_trickster",
]);

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

const sourceItemQuantitiesFor = (file: string): Readonly<Record<string, number>> | undefined =>
  file === "32_midorikatai_bonecrusher" ? { "item-equipment-first-aid-kit": 2 } : undefined;

const sourceGapsFor = (
  file: string,
  path: string,
  raceId: string,
  transformationId: string,
  maximumKi: number,
  specializationType: "strength" | "energy",
  itemIds: readonly string[],
): readonly SimulationGap[] => [
  {
    kind: "capability",
    reason: `${specializationType[0]!.toUpperCase()}${specializationType.slice(1)} specialization damage is retained as source metadata; the combat input has no specialization-type field.`,
    provenance: {
      path,
      text: "Specialization effects are listed on the source sheet but are not part of the current combat input contract.",
      sourceKind: "balance-sheet",
    },
  },
  ...(maximumKi === 12
    ? [
        {
          kind: "capability" as const,
          reason:
            "The source sheet has a maximum Ki of 12; the current combat boundary derives maximum Ki from the mechanics view and has no per-combatant override.",
          provenance: {
            path,
            text: "Starting / Maximum KI source field",
            sourceKind: "balance-sheet" as const,
          },
        },
      ]
    : []),
  ...(combatActiveTransformationRaceIds.has(raceId)
    ? []
    : [
        {
          kind: "capability" as const,
          reason: `The source transformation ${transformationId} is preserved as metadata but its race is outside the active six-family local combat scope.`,
          provenance: {
            path,
            text: "TF1 transformation profile",
            sourceKind: "balance-sheet" as const,
          },
        },
      ]),
  ...(itemIds.includes("item-ships-space-pod")
    ? [
        {
          kind: "capability" as const,
          reason:
            "Space Pod is retained as the canonical ship item, but its travel permission is outside the local 1v1 combat scope.",
          provenance: {
            path,
            text: "Space Pod (starting spacecraft)",
            sourceKind: "balance-sheet" as const,
          },
        },
      ]
    : []),
  ...(sourceItemQuantitiesFor(file) !== undefined
    ? [
        {
          kind: "item" as const,
          reason:
            "The source lists two First Aid Kits; the combat input preserves the item ID once and has no inventory-quantity field.",
          provenance: {
            path,
            text: "First Aid Kit x2 (starting inventory)",
            sourceKind: "balance-sheet" as const,
          },
        },
      ]
    : []),
];

const sourceTemplateFor = (row: SourceRow): SimulationTemplate => {
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
  const styleId = styleIds[style];
  const raceId = raceIds[race];
  const classId = classIds[className];
  const moveIds = sourceMovesByFile[file];
  const itemIds = sourceItemsByRace[raceId];
  const raceTraitIds = sourceTraitsByRaceAndClass[`${raceId}:${classId}`];
  const startingKi = sixStartingKiFiles.has(file) ? 6 : 5;
  const maximumKi = twelveMaximumKiFiles.has(file) ? 12 : 10;
  const specializationType = energySpecializationFiles.has(file) ? "energy" : "strength";
  const transformationId = transformationIdFor(transformation, raceId);
  return simulationTemplateSchema.parse({
    schemaVersion: "simulation-contracts:v1",
    id: templateId,
    label: mastery,
    kind: "tf1-source",
    checkpointId: "tf1",
    source: { path, text: `${mastery} TF1 source sheet`, sourceKind: "balance-sheet" },
    raceId,
    classId,
    styleId,
    mastery,
    specializationPoints: hpSp + powerSp + dexteritySp,
    specializationPointsDistribution: {
      hp: hpSp,
      power: powerSp,
      dexterity: dexteritySp,
      total: hpSp + powerSp + dexteritySp,
    },
    startingKiPolicy: "rules-default",
    startingKi,
    maximumKi,
    specialization: {
      type: specializationType,
      level: 1,
      damageType: specializationType === "energy" ? "energy" : "physical",
    },
    transformationName: transformation,
    maximumHitPoints: hp,
    stats: { power, dexterity, dexterityBonus: Number(dexterityBonus) },
    raceTraitIds,
    moveIds,
    itemIds,
    itemQuantities: sourceItemQuantitiesFor(file),
    transformationProfiles: [
      {
        transformationId,
        rollSides: tfMastery === "mastered" ? 100 : 20,
        mastery: tfMastery,
      },
    ],
    loadoutOverlay: overlayFor(templateId, styleId, mastery, moveIds),
    gaps: sourceGapsFor(
      file,
      path,
      raceId,
      transformationId,
      maximumKi,
      specializationType,
      itemIds,
    ),
    aiProfileId: profileId,
  });
};

export const TF1_SIMULATION_TEMPLATES: readonly SimulationTemplate[] = Object.freeze(
  sourceRows.map((row) => sourceTemplateFor(row)),
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
  approvalReference: string = SIMULATION_TF1_SOURCE_AUTHORITY,
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
    gaps: template.gaps.filter((gap) => gap.kind !== "loadout"),
  });
};

/** Approves the complete checked-in TF1 overlay set under one review reference. */
export const approveAllSimulationTf1Overlays = (
  approvalReference: string = SIMULATION_TF1_SOURCE_AUTHORITY,
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
  if (
    value.kind === "tf1-source" &&
    (value.startingKi === undefined ||
      value.maximumKi === undefined ||
      value.specialization === undefined)
  )
    return failure(
      "unsupported-template",
      value.id,
      "TF1 source template must preserve starting/maximum Ki and specialization metadata.",
    );
  if (value.kind === "tf1-source" && value.loadoutOverlay === undefined)
    return failure(
      "unsupported-template",
      value.id,
      "TF1 source template requires a source loadout overlay.",
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
    // The source sheets define their own ordered sections. Canonical move categories are
    // intentionally not used to reselect or drop source-listed moves at this boundary.
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
  const knownTraitIds = new Set(
    view.races.flatMap((candidateRace) => candidateRace.racialTraits.map((trait) => trait.id)),
  );
  if (!value.raceTraitIds.every((id) => knownTraitIds.has(id)))
    return failure(
      "unknown-reference",
      value.id,
      "Template contains an unknown race-trait reference.",
    );
  if (
    value.itemQuantities !== undefined &&
    Object.keys(value.itemQuantities).some((itemId) => !value.itemIds.includes(itemId))
  )
    return failure(
      "incompatible-loadout",
      value.id,
      "Template item quantities must refer to retained item IDs.",
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
        view.indexes.moves.get(id)?.styleId === value.styleId ||
        view.indexes.moves.get(id)?.styleId === "style-freestyle",
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
  const runtimeTransformationProfiles =
    value.kind !== "tf1-source"
      ? value.transformationProfiles
      : value.transformationProfiles.filter((profile) => {
          const transformation = view.indexes.transformations.get(profile.transformationId);
          return (
            transformation === undefined ||
            combatActiveTransformationRaceIds.has(transformation.raceId)
          );
        });
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
    transformationProfiles: runtimeTransformationProfiles,
    transformationIds: runtimeTransformationProfiles.map((profile) => profile.transformationId),
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
