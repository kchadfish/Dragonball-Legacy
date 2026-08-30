/* eslint-disable sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, complexity, @typescript-eslint/no-unnecessary-condition, sonarjs/different-types-comparison, @typescript-eslint/no-unnecessary-type-assertion */
import {
  personalityDimensionNames,
  type AiProfile,
  type AiProfileValidationResult,
  type AiProfileValidationIssue,
  type DifficultySettings,
  type PersonalityDimensions,
  type PersonalityWeights,
} from "./contracts.js";

export const AI_PROFILE_VERSION = "ai-profile:v1";
export const AI_DIFFICULTY_VERSION = "ai-difficulty:v1";

const defaultDimensions: PersonalityDimensions = Object.freeze({
  aggression: 1,
  damage: 1,
  defense: 1,
  status: 1,
  "ki-conservation": 1,
  "risk-tolerance": 1,
  "transformation-preference": 1,
  "scarcity-conservation": 1,
  "combo-preference": 1,
});

const defaultsByLevel = {
  easy: {
    precision: 0.55,
    comboAwareness: 0.35,
    opponentAwareness: 0.25,
    candidateLimit: 8,
    responseLimit: 2,
    lookaheadDepth: 0,
    maxNodes: 32,
    maxProbes: 16,
    scoreNoiseMinimum: -8_000,
    scoreNoiseMaximum: 8_000,
    mistakeProbability: 12,
    preserveResources: 0.5,
  },
  normal: {
    precision: 0.8,
    comboAwareness: 0.65,
    opponentAwareness: 0.6,
    candidateLimit: 16,
    responseLimit: 4,
    lookaheadDepth: 1,
    maxNodes: 128,
    maxProbes: 64,
    scoreNoiseMinimum: -2_000,
    scoreNoiseMaximum: 2_000,
    mistakeProbability: 3,
    preserveResources: 0.8,
  },
  hard: {
    precision: 1,
    comboAwareness: 1,
    opponentAwareness: 0.95,
    candidateLimit: 32,
    responseLimit: 8,
    lookaheadDepth: 2,
    maxNodes: 512,
    maxProbes: 256,
    scoreNoiseMinimum: -250,
    scoreNoiseMaximum: 250,
    mistakeProbability: 0,
    preserveResources: 1,
  },
  simulation: {
    precision: 1,
    comboAwareness: 1,
    opponentAwareness: 1,
    candidateLimit: 64,
    responseLimit: 16,
    lookaheadDepth: 2,
    maxNodes: 2_048,
    maxProbes: 1_024,
    scoreNoiseMinimum: 0,
    scoreNoiseMaximum: 0,
    mistakeProbability: 0,
    preserveResources: 1,
  },
} as const;

const defaultControlsFor = (level: DifficultySettings["level"]) =>
  defaultsByLevel[
    level === "simulation-quality"
      ? "simulation"
      : level === "hard"
        ? "hard"
        : level === "easy"
          ? "easy"
          : "normal"
  ];

export type ResolvedDifficultySettings = Omit<DifficultySettings, "level" | "version"> & {
  readonly level: DifficultySettings["level"];
  readonly version: string;
  readonly precision: number;
  readonly comboAwareness: number;
  readonly opponentAwareness: number;
  readonly candidateLimit: number;
  readonly responseLimit: number;
  readonly lookaheadDepth: number;
  readonly maxNodes: number;
  readonly maxProbes: number;
  readonly scoreNoiseMinimum: number;
  readonly scoreNoiseMaximum: number;
  readonly mistakeProbability: number;
  readonly preserveResources: number;
};

const issue = (path: string, message: string): AiProfileValidationIssue => ({ path, message });

const validNumber = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

export const resolvePersonalityDimensions = (
  personality: PersonalityWeights,
): PersonalityDimensions => {
  const source: Readonly<Record<string, unknown>> =
    personality.dimensions ?? personality.values ?? {};
  return Object.freeze(
    Object.fromEntries(
      personalityDimensionNames.map((name) => [
        name,
        validNumber(source[name], 0, 2) ? source[name] : defaultDimensions[name],
      ]),
    ) as PersonalityDimensions,
  );
};

export const resolveDifficultySettings = (
  difficulty: DifficultySettings,
): ResolvedDifficultySettings => {
  const level: keyof typeof defaultsByLevel =
    difficulty.level === "simulation-quality"
      ? "simulation"
      : difficulty.level === "hard"
        ? "hard"
        : difficulty.level === "easy"
          ? "easy"
          : "normal";
  const base = defaultsByLevel[level];
  /*
    The profile contract accepts custom level labels, so unknown labels use the
    normal controls while retaining the caller's label in the resolved value.
  */
  return Object.freeze({
    ...base,
    ...difficulty,
    version: difficulty.version || AI_DIFFICULTY_VERSION,
  }) as ResolvedDifficultySettings;
};

export const validateAiProfile = (profile: AiProfile): AiProfileValidationResult => {
  const issues: AiProfileValidationIssue[] = [];
  if (profile === null || typeof profile !== "object")
    return { ok: false, issues: [issue("profile", "A profile is required.")] };
  if (typeof profile.identity?.id !== "string" || profile.identity.id.length === 0)
    issues.push(issue("identity.id", "Profile ID is required."));
  if (typeof profile.identity?.version !== "string" || profile.identity.version.length === 0)
    issues.push(issue("identity.version", "Profile version is required."));
  if (typeof profile.personality?.version !== "string" || profile.personality.version.length === 0)
    issues.push(issue("personality.version", "Personality version is required."));
  const dimensions =
    profile.personality === undefined
      ? undefined
      : resolvePersonalityDimensions(profile.personality);
  for (const name of personalityDimensionNames)
    if (
      profile.personality?.dimensions?.[name] !== undefined &&
      !validNumber(profile.personality.dimensions[name], 0, 2)
    )
      issues.push(issue(`personality.dimensions.${name}`, "Dimension must be between 0 and 2."));
  if (profile.difficulty === undefined) issues.push(issue("difficulty", "Difficulty is required."));
  else {
    const resolved = resolveDifficultySettings(profile.difficulty);
    const bounded = [
      ["precision", resolved.precision, 0, 1],
      ["comboAwareness", resolved.comboAwareness, 0, 1],
      ["opponentAwareness", resolved.opponentAwareness, 0, 1],
      ["preserveResources", resolved.preserveResources, 0, 1],
      ["mistakeProbability", resolved.mistakeProbability, 0, 100],
    ] as const;
    for (const [name, value, minimum, maximum] of bounded)
      if (!validNumber(value, minimum, maximum))
        issues.push(issue(`difficulty.${name}`, "Difficulty control is out of range."));
    for (const [name, value] of [
      ["candidateLimit", resolved.candidateLimit],
      ["responseLimit", resolved.responseLimit],
      ["lookaheadDepth", resolved.lookaheadDepth],
      ["maxNodes", resolved.maxNodes],
      ["maxProbes", resolved.maxProbes],
    ] as const)
      if (!Number.isInteger(value) || value < 0)
        issues.push(
          issue(`difficulty.${name}`, "Difficulty limit must be a non-negative integer."),
        );
    if (resolved.scoreNoiseMinimum > resolved.scoreNoiseMaximum)
      issues.push(issue("difficulty.scoreNoise", "Noise bounds must be ordered."));
  }
  return issues.length === 0
    ? { ok: true, value: { ...profile, personality: { ...profile.personality, dimensions } } }
    : { ok: false, issues };
};

export const createAiProfile = (input: AiProfile): AiProfileValidationResult =>
  validateAiProfile(input);

const profileFor = (id: string, level: DifficultySettings["level"]): AiProfile => ({
  identity: { id, version: AI_PROFILE_VERSION },
  personality: {
    version: "personality:v1",
    dimensions: defaultDimensions,
    values: defaultDimensions,
  },
  difficulty: {
    version: AI_DIFFICULTY_VERSION,
    level,
    ...defaultControlsFor(level),
  },
});

export const EASY_PROFILE = Object.freeze(profileFor("profile:easy", "easy"));
export const NORMAL_PROFILE = Object.freeze(profileFor("profile:normal", "normal"));
export const HARD_PROFILE = Object.freeze(profileFor("profile:hard", "hard"));
export const SIMULATION_QUALITY_PROFILE = Object.freeze(
  profileFor("profile:simulation-quality", "simulation-quality"),
);
export const easyProfile = EASY_PROFILE;
export const normalProfile = NORMAL_PROFILE;
export const hardProfile = HARD_PROFILE;
export const simulationQualityProfile = SIMULATION_QUALITY_PROFILE;
