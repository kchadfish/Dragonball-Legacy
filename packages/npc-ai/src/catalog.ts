import {
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
} from "@dragonball-resurgence/ai-engine";
import { MOVE_DEFINITIONS, NPC_DEFINITIONS, type NpcId } from "@dragonball-resurgence/game-data";

import { validateNpcAiPolicy } from "./index.js";
import type { NpcAiPolicy, NpcAiPolicyProvenance, NpcAiPolicyValidationIssue } from "./index.js";
import { assessNpcReadiness, npcReadinessMatrix } from "./normalization.js";

export const NPC_POLICY_CATALOG_VERSION = "npc-policy-catalog:v1";
const NPC_AI_POLICY_VERSION = "npc-ai-policy:v1";

/** Small style tendencies; authored NPC policy remains the dominant input. */
export const NPC_STYLE_BASELINE_PRIORITIES: Readonly<
  Record<string, NpcAiPolicy["tacticalPriorities"]>
> = Object.freeze({
  "style-akaikaru": [{ type: "aggressive-phase", id: "style-akaikaru-pressure", weight: 0.1 }],
  "style-aoyosumu": [{ type: "status-pressure", id: "style-aoyosumu-control", weight: 0.1 }],
  "style-haokiru": [{ type: "transformation-timing", id: "style-haokiru-timing", weight: 0.1 }],
  "style-kurokonwaku": [{ type: "status-pressure", id: "style-kurokonwaku-control", weight: 0.1 }],
  "style-midorikatai": [
    { type: "aggressive-phase", id: "style-midorikatai-pressure", weight: 0.1 },
  ],
});

const policy = (
  id: string,
  profile: NpcAiPolicy["defaultProfile"],
  tacticalPriorities: NpcAiPolicy["tacticalPriorities"] = [],
  provenance: NpcAiPolicyProvenance = "npc-design",
): NpcAiPolicy => ({
  version: NPC_AI_POLICY_VERSION,
  id,
  provenance,
  defaultProfile: profile,
  tacticalPriorities,
});

export const NPC_POLICY_BALANCED = policy("npc-policy-balanced", NORMAL_PROFILE, [
  { type: "status-pressure", id: "balanced-status", weight: 0.15 },
]);
export const NPC_POLICY_AGGRESSIVE = policy("npc-policy-aggressive", HARD_PROFILE, [
  { type: "aggressive-phase", id: "aggressive-pressure", weight: 0.35 },
]);
export const NPC_POLICY_DEFENSIVE = policy("npc-policy-defensive", NORMAL_PROFILE, [
  {
    type: "signature-conservation",
    id: "defensive-conservation",
    weight: 0.2,
    moveIds: ["move-aoyosumu-inner-peace"],
  },
]);
export const NPC_POLICY_CONTROL = policy("npc-policy-control", NORMAL_PROFILE, [
  { type: "status-pressure", id: "control-status", weight: 0.45 },
]);
export const NPC_POLICY_RESOURCE_CONSERVING = policy(
  "npc-policy-resource-conserving",
  NORMAL_PROFILE,
  [
    {
      type: "signature-conservation",
      id: "resource-conservation",
      weight: 0.35,
      moveIds: ["move-aoyosumu-inner-peace"],
    },
  ],
);
export const NPC_POLICY_ELITE = policy("npc-policy-elite", HARD_PROFILE, [
  { type: "status-pressure", id: "elite-status", weight: 0.25 },
  { type: "aggressive-phase", id: "elite-pressure", weight: 0.2 },
]);
export const NPC_POLICY_BOSS_QUALITY: NpcAiPolicy = {
  version: NPC_AI_POLICY_VERSION,
  id: "npc-policy-boss-quality",
  provenance: "saga-design",
  defaultProfile: SIMULATION_QUALITY_PROFILE,
  tacticalPriorities: [{ type: "transformation-timing", id: "boss-transformation", weight: 0.3 }],
  phases: [
    {
      id: "phase-opening",
      priority: 10,
      when: { turn: { maximum: 2 } },
      profile: HARD_PROFILE,
      tacticalPriorities: [
        {
          type: "signature-conservation",
          id: "opening-conservation",
          weight: 0.2,
          moveIds: ["move-aoyosumu-inner-peace"],
        },
      ],
    },
    {
      id: "phase-enraged",
      priority: 20,
      when: { selfHpRatio: { maximum: 0.35 } },
      profile: SIMULATION_QUALITY_PROFILE,
      tacticalPriorities: [{ type: "aggressive-phase", id: "enraged-pressure", weight: 0.4 }],
    },
  ],
};

export const SYNTHETIC_TWO_PHASE_BOSS_POLICY: NpcAiPolicy = {
  ...NPC_POLICY_BOSS_QUALITY,
  id: "npc-policy-synthetic-two-phase-boss",
  phases: [
    {
      id: "phase-opening",
      priority: 10,
      when: { turn: { maximum: 3 } },
      profile: NORMAL_PROFILE,
    },
    {
      id: "phase-enraged",
      priority: 20,
      when: { selfHpRatio: { maximum: 0.4 } },
      profile: HARD_PROFILE,
      tacticalPriorities: [{ type: "aggressive-phase", id: "two-phase-rage", weight: 0.4 }],
    },
  ],
};

export const SYNTHETIC_THREE_PHASE_BOSS_POLICY: NpcAiPolicy = {
  ...NPC_POLICY_BOSS_QUALITY,
  id: "npc-policy-synthetic-three-phase-boss",
  phases: [
    {
      id: "phase-opening",
      priority: 10,
      when: { turn: { maximum: 2 } },
      profile: NORMAL_PROFILE,
    },
    {
      id: "phase-pressured",
      priority: 20,
      when: { selfHpRatio: { maximum: 0.65, minimum: 0.31 } },
      profile: HARD_PROFILE,
      tacticalPriorities: [{ type: "status-pressure", id: "three-phase-control", weight: 0.25 }],
    },
    {
      id: "phase-enraged",
      priority: 30,
      when: { selfHpRatio: { maximum: 0.3 } },
      profile: SIMULATION_QUALITY_PROFILE,
      tacticalPriorities: [{ type: "aggressive-phase", id: "three-phase-rage", weight: 0.5 }],
    },
  ],
};

export const NPC_POLICY_CATALOG: readonly NpcAiPolicy[] = [
  NPC_POLICY_BALANCED,
  NPC_POLICY_AGGRESSIVE,
  NPC_POLICY_DEFENSIVE,
  NPC_POLICY_CONTROL,
  NPC_POLICY_RESOURCE_CONSERVING,
  NPC_POLICY_ELITE,
  NPC_POLICY_BOSS_QUALITY,
  SYNTHETIC_TWO_PHASE_BOSS_POLICY,
  SYNTHETIC_THREE_PHASE_BOSS_POLICY,
];

export const AUTOMATED_NPC_POLICY_ASSIGNMENTS: Readonly<Partial<Record<NpcId, string>>> =
  Object.freeze({
    "npc-alpha-collective-ransom-seeker-1": "npc-policy-balanced",
    "npc-alpha-collective-the-street-shade-1": "npc-policy-defensive",
    "npc-earth-east-limax-1": "npc-policy-control",
    "npc-earth-east-chaos-browncoat-1": "npc-policy-aggressive",
    "npc-earth-north-prototype-b-1": "npc-policy-balanced",
    "npc-earth-south-ox-king-the-27th-1": "npc-policy-elite",
    "npc-earth-south-aberax-1": "npc-policy-aggressive",
    "npc-namek-snare-1": "npc-policy-defensive",
    "npc-namek-steelpan-1": "npc-policy-aggressive",
    "npc-namek-tenor-1": "npc-policy-elite",
  });

export const policyForNpc = (npcId: NpcId): NpcAiPolicy | undefined => {
  const policyId = AUTOMATED_NPC_POLICY_ASSIGNMENTS[npcId];
  const selected = NPC_POLICY_CATALOG.find((candidate) => candidate.id === policyId);
  if (selected === undefined) return undefined;
  const styleId = NPC_DEFINITIONS.find((npc) => npc.id === npcId)?.styleId;
  const baseline = styleId === undefined ? undefined : NPC_STYLE_BASELINE_PRIORITIES[styleId];
  return baseline === undefined
    ? selected
    : {
        ...selected,
        tacticalPriorities: [...baseline, ...(selected.tacticalPriorities ?? [])],
      };
};

export interface NpcPolicyCatalogValidationResult {
  readonly ok: boolean;
  readonly issues: readonly NpcAiPolicyValidationIssue[];
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- catalog validation reports independent drift classes together.
export const validateNpcPolicyCatalog = (): NpcPolicyCatalogValidationResult => {
  const issues: NpcAiPolicyValidationIssue[] = [];
  const catalogIds = new Set<string>();
  for (const candidate of NPC_POLICY_CATALOG) {
    if (catalogIds.has(candidate.id))
      issues.push({ path: "catalog", message: `Duplicate policy: ${candidate.id}.` });
    catalogIds.add(candidate.id);
    const validation = validateNpcAiPolicy(candidate);
    if (!validation.ok) issues.push(...validation.issues);
    for (const priority of [
      ...(candidate.tacticalPriorities ?? []),
      ...(candidate.phases ?? []).flatMap((phase) => phase.tacticalPriorities ?? []),
    ])
      if (priority.type === "signature-conservation")
        for (const moveId of priority.moveIds)
          if (!MOVE_DEFINITIONS.some((move) => move.id === moveId))
            issues.push({ path: candidate.id, message: `Unknown move priority: ${moveId}.` });
  }
  for (const npc of NPC_DEFINITIONS) {
    const assignment = AUTOMATED_NPC_POLICY_ASSIGNMENTS[npc.id];
    const readiness = assessNpcReadiness(npc);
    if (readiness.ok && assignment === undefined)
      issues.push({ path: npc.id, message: "Automated NPC has no policy assignment." });
    if (!readiness.ok && assignment !== undefined)
      issues.push({ path: npc.id, message: "Manual-only NPC has a policy assignment." });
    if (assignment !== undefined && !catalogIds.has(assignment))
      issues.push({ path: npc.id, message: `Unknown policy assignment: ${assignment}.` });
  }
  for (const row of npcReadinessMatrix((npcId) => AUTOMATED_NPC_POLICY_ASSIGNMENTS[npcId])) {
    if (row.runtimeClassification === "automated" && row.effectivePolicyId === undefined)
      issues.push({
        path: row.npcId,
        message: "Readiness row is missing effective policy provenance.",
      });
  }
  return { ok: issues.length === 0, issues };
};
