import type { SourceReference, StatusDefinition } from "./types.js";

export const COMBAT_RESULT_TYPE = {
  SUCCESSFUL: "successful",
  STOPPED: "stopped",
  CRITICAL: "critical",
  COUNTER: "counter",
} as const;

export const EFFECT_OPERATION_TYPE = {
  DEACTIVATE: "deactivate",
  NEGATE: "negate",
  LOCK: "lock",
  SUPPRESS: "suppress",
} as const;

export interface CombatResultDefinition {
  readonly id: (typeof COMBAT_RESULT_TYPE)[keyof typeof COMBAT_RESULT_TYPE];
  readonly name: string;
  readonly description: string;
  readonly source: SourceReference;
}

export interface EffectOperationDefinition {
  readonly id: (typeof EFFECT_OPERATION_TYPE)[keyof typeof EFFECT_OPERATION_TYPE];
  readonly name: string;
  readonly description: string;
  readonly source: SourceReference;
}

const rulesSource = (text: string): SourceReference => ({
  path: "reference/rules.md",
  text,
});

export const COMBAT_RESULTS: readonly CombatResultDefinition[] = [
  {
    id: COMBAT_RESULT_TYPE.SUCCESSFUL,
    name: "Successful",
    description: "An attack roll resolves as successful.",
    source: rulesSource("Referenced throughout move effects as SUCCESSFUL."),
  },
  {
    id: COMBAT_RESULT_TYPE.STOPPED,
    name: "Stopped",
    description: "An attack is stopped by a defensive resolution.",
    source: rulesSource("Referenced throughout move effects as STOPPED."),
  },
  {
    id: COMBAT_RESULT_TYPE.CRITICAL,
    name: "Critical",
    description: "A natural highest attack roll doubles base damage before modifiers.",
    source: rulesSource("reference/rules.md:358-366"),
  },
  {
    id: COMBAT_RESULT_TYPE.COUNTER,
    name: "Counter",
    description: "A qualifying stopped attack grants the defender a counter attack.",
    source: rulesSource("reference/rules.md:182-184; 370-372"),
  },
];

export const EFFECT_OPERATIONS: readonly EffectOperationDefinition[] = [
  {
    id: EFFECT_OPERATION_TYPE.DEACTIVATE,
    name: "Deactivate",
    description: "Turn off an active Skill without removing it from the moveset.",
    source: rulesSource("reference/rules.md:317"),
  },
  {
    id: EFFECT_OPERATION_TYPE.NEGATE,
    name: "Negate",
    description: "Prevent an effect from resolving without removing its source.",
    source: rulesSource("reference/rules.md:319"),
  },
  {
    id: EFFECT_OPERATION_TYPE.LOCK,
    name: "Lock",
    description: "Prevent use, performance, or activation of a specified target for a duration.",
    source: rulesSource("reference/rules.md:321"),
  },
  {
    id: EFFECT_OPERATION_TYPE.SUPPRESS,
    name: "Suppress",
    description: "Ignore all non-damage effects of an affected move.",
    source: rulesSource("reference/rules.md:325"),
  },
];

export const CORE_STATUS_DEFINITIONS: readonly StatusDefinition[] = [
  {
    id: "stun",
    name: "Stun",
    stacking: "refresh-duration",
    defaultDuration: 1,
    effects: [
      {
        trigger: "action-phase",
        type: "skip-action",
        sourceText: "The affected opponent skips their next turn.",
      },
    ],
  },
  {
    id: "break",
    name: "Break",
    stacking: "stacks",
    effects: [
      {
        trigger: "passive",
        type: "modify-damage",
        sourceText: "Attacks deal -10% damage per break for 7 days, up to four breaks.",
      },
    ],
  },
  {
    id: "sever",
    name: "Sever",
    stacking: "stacks",
    effects: [
      {
        trigger: "passive",
        type: "modify-damage",
        sourceText: "Attacks deal -25% damage per severed limb until restored in the Afterlife.",
      },
    ],
  },
  {
    id: "cooldown",
    name: "Cooldown",
    stacking: "refresh-duration",
    effects: [
      {
        trigger: "passive",
        type: "prevent-move-use",
        sourceText:
          "The affected move or effect cannot be used again for its listed turn duration.",
      },
    ],
  },
];
