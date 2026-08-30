/* eslint-disable sonarjs/cognitive-complexity, complexity -- readiness intentionally reports all blocking mechanics in one immutable assessment. */
import type { CreateFightInput } from "@dragonball-resurgence/combat-engine";
import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import {
  ITEM_DEFINITIONS,
  NPC_DEFINITIONS,
  RACE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type NpcDefinition,
  type NpcId,
  type SourceNumericValue,
} from "@dragonball-resurgence/game-data";

export const NPC_NORMALIZATION_VERSION = "npc-normalization:v1";

export type NpcReadinessReason =
  | "missing-combat-profile"
  | "missing-stat"
  | "relative-stat"
  | "missing-dexterity-allocation"
  | "unresolved-move"
  | "unknown-equipment"
  | "unsupported-battle-note"
  | "ambiguous-race"
  | "ambiguous-style"
  | "unresolved-transformation"
  | "unsupported-transformation"
  | "unsupported-source-mechanic";

export interface NpcReadinessIssue {
  readonly reason: NpcReadinessReason;
  readonly message: string;
  readonly sourceReference: { readonly path: string; readonly text: string };
}

export interface NpcNormalizationOverlay {
  readonly npcId: NpcId;
  /** Source-normalized allocation semantics; combat derives the bonus from the universal chart. */
  readonly dexterityAllocationPercent?: number;
  readonly raceId?: string;
  readonly styleId?: string;
  readonly itemIds?: readonly string[];
  readonly transformationIds?: readonly string[];
  readonly classId?: string;
  readonly raceTraitIds?: readonly string[];
}

export type NpcReadinessStatus = "automated" | "manual-only";

export interface NpcReadinessRow {
  readonly npcId: NpcId;
  readonly sourceReference: { readonly path: string; readonly text: string };
  readonly hpStatus: "resolved" | "unresolved";
  readonly powerStatus: "resolved" | "unresolved";
  readonly dexterityStatus: "resolved" | "unresolved";
  readonly dexterityBonusStatus: "resolved" | "unresolved";
  readonly raceReference?: string;
  readonly styleReference?: string;
  readonly resolvedMoves: readonly string[];
  readonly unresolvedMoves: readonly string[];
  readonly resolvedItems: readonly string[];
  readonly unresolvedItems: readonly string[];
  readonly resolvedTransformations: readonly string[];
  readonly unresolvedTransformations: readonly string[];
  readonly battleNotesStatus: "none" | "unsupported";
  readonly runtimeClassification: NpcReadinessStatus;
  readonly effectivePolicyId?: string;
  readonly issues: readonly NpcReadinessIssue[];
  readonly testEvidence: readonly string[];
}

export type NpcReadinessResult =
  | { readonly ok: true; readonly value: NpcReadinessRow }
  | { readonly ok: false; readonly row: NpcReadinessRow };

export type NpcCombatantMaterialization =
  | { readonly ok: true; readonly value: CreateFightInput["combatants"][number] }
  | { readonly ok: false; readonly npcId: NpcId; readonly issues: readonly NpcReadinessIssue[] };

const stableKey = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[’']/gu, "")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();

const uniqueMatches = <T>(values: readonly T[], predicate: (value: T) => boolean): readonly T[] =>
  values.filter(predicate);

const raceFor = (npc: NpcDefinition, overlay: NpcNormalizationOverlay | undefined) => {
  const requested = overlay?.raceId ?? npc.raceId;
  if (requested !== undefined) return RACE_DEFINITIONS.find((race) => race.id === requested);
  if (npc.raceName === undefined) return undefined;
  const matches = uniqueMatches(
    RACE_DEFINITIONS,
    (race) => stableKey(race.name) === stableKey(npc.raceName!),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const styleIdFor = (
  npc: NpcDefinition,
  overlay: NpcNormalizationOverlay | undefined,
): string | undefined => {
  if (overlay?.styleId !== undefined) return overlay.styleId;
  if (npc.styleId !== undefined) return npc.styleId;
  if (npc.styleName === undefined) return undefined;
  const knownStyles = new Set([
    "style-akaikaru",
    "style-aoyosumu",
    "style-haokiru",
    "style-kiihakai",
    "style-kurokonwaku",
    "style-midorikatai",
    "style-freestyle",
  ]);
  const candidate = `style-${stableKey(npc.styleName)}`;
  return knownStyles.has(candidate) ? candidate : undefined;
};

const numericValue = (value: SourceNumericValue | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (value.resolvedValue !== undefined) return value.resolvedValue;
  if (value.sourceText.includes("%")) return undefined;
  return value.baseValue;
};

const statStatus = (value: SourceNumericValue | undefined): "resolved" | "unresolved" =>
  numericValue(value) === undefined ? "unresolved" : "resolved";

const dexterityBonusFor = (allocation: number | undefined): number | undefined => {
  if (allocation === undefined) return undefined;
  const bands: readonly [number, number][] = [
    [0, -4],
    [10, -3],
    [20, -2],
    [25, -1],
    [30, 0],
    [35, 1],
    [40, 2],
    [50, 3],
  ];
  return [...bands].reverse().find(([minimum]) => allocation >= minimum)?.[1] ?? -4;
};

const transformationFor = (text: string) => {
  const bracketIndex = text.lastIndexOf("[");
  const name = (bracketIndex < 0 ? text : text.slice(0, bracketIndex)).trim();
  const matches = uniqueMatches(
    TRANSFORMATION_DEFINITIONS,
    (transformation) => stableKey(transformation.name) === stableKey(name),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const transformationRollSidesFor = (text: string): number | undefined => {
  const match = /1d(\d+)/iu.exec(text);
  return match === null ? undefined : Number(match[1]);
};

const issueFor = (
  npc: NpcDefinition,
  reason: NpcReadinessReason,
  message: string,
): NpcReadinessIssue => ({
  reason,
  message,
  sourceReference: npc.source,
});

export const NPC_NORMALIZATION_OVERLAYS: readonly NpcNormalizationOverlay[] = [
  "npc-alpha-collective-ransom-seeker-1",
  "npc-alpha-collective-the-street-shade-1",
  "npc-earth-east-limax-1",
  "npc-earth-east-chaos-browncoat-1",
  "npc-earth-east-lilith-1",
  "npc-earth-north-prototype-b-1",
  "npc-earth-south-ox-king-the-27th-1",
  "npc-earth-south-aberax-1",
  "npc-namek-snare-1",
  "npc-namek-steelpan-1",
  "npc-namek-tenor-1",
].map((npcId) => ({
  npcId: npcId as NpcId,
  dexterityAllocationPercent: npcId === "npc-earth-south-aberax-1" ? 39 : 30,
  ...(npcId === "npc-namek-snare-1" ? { raceId: "race-namek" } : {}),
}));

export const normalizationOverlayFor = (npcId: NpcId): NpcNormalizationOverlay | undefined =>
  NPC_NORMALIZATION_OVERLAYS.find((overlay) => overlay.npcId === npcId);

export const assessNpcReadiness = (
  npc: NpcDefinition,
  overlay: NpcNormalizationOverlay | undefined = normalizationOverlayFor(npc.id),
  effectivePolicyId?: string,
): NpcReadinessResult => {
  const profile = npc.combatProfile;
  const issues: NpcReadinessIssue[] = [];
  if (profile === undefined)
    issues.push(issueFor(npc, "missing-combat-profile", "NPC has no combat profile."));
  const hpStatus = statStatus(profile?.hitPoints);
  const powerStatus = statStatus(profile?.power);
  const dexterityStatus = statStatus(profile?.dexterity);
  if (hpStatus === "unresolved")
    issues.push(
      issueFor(
        npc,
        profile?.hitPoints === undefined ? "missing-stat" : "relative-stat",
        "HP is not a concrete source value.",
      ),
    );
  if (powerStatus === "unresolved")
    issues.push(
      issueFor(
        npc,
        profile?.power === undefined ? "missing-stat" : "relative-stat",
        "Power is not a concrete source value.",
      ),
    );
  if (dexterityStatus === "unresolved")
    issues.push(
      issueFor(
        npc,
        profile?.dexterity === undefined ? "missing-stat" : "relative-stat",
        "Dexterity is not a concrete source value.",
      ),
    );
  const dexterityBonusStatus =
    dexterityBonusFor(overlay?.dexterityAllocationPercent) === undefined
      ? "unresolved"
      : "resolved";
  if (dexterityBonusStatus === "unresolved")
    issues.push(
      issueFor(
        npc,
        "missing-dexterity-allocation",
        "Base Dexterity Bonus requires canonical allocation semantics.",
      ),
    );

  const race = raceFor(npc, overlay);
  if (
    (npc.raceId !== undefined || npc.raceName !== undefined || overlay?.raceId !== undefined) &&
    race === undefined
  )
    issues.push(issueFor(npc, "ambiguous-race", "Race reference is not uniquely resolvable."));
  const styleId = styleIdFor(npc, overlay);
  if (npc.styleName !== undefined && styleId === undefined)
    issues.push(issueFor(npc, "ambiguous-style", "Style reference is not uniquely resolvable."));

  const unresolvedMoves = [...npc.unresolvedMoveNames];
  for (const move of unresolvedMoves)
    issues.push(issueFor(npc, "unresolved-move", `Move is unresolved: ${move}.`));
  const resolvedItems = (overlay?.itemIds ?? []).concat(
    (profile?.equipmentNames ?? []).flatMap((name) => {
      const matches = ITEM_DEFINITIONS.filter((item) => stableKey(item.name) === stableKey(name));
      return matches.length === 1 ? [matches[0].id] : [];
    }),
  );
  const unresolvedItems = (profile?.equipmentNames ?? []).filter(
    (name) => !ITEM_DEFINITIONS.some((item) => stableKey(item.name) === stableKey(name)),
  );
  for (const item of unresolvedItems)
    issues.push(issueFor(npc, "unknown-equipment", `Equipment is unresolved: ${item}.`));

  const transformationNames =
    profile?.transformationText === undefined ? [] : [profile.transformationText];
  const resolvedTransformations = (overlay?.transformationIds ?? []).concat(
    transformationNames.flatMap((text) => {
      const transformation = transformationFor(text);
      return transformation === undefined ? [] : [transformation.id];
    }),
  );
  const unresolvedTransformations = transformationNames.filter(
    (text) => transformationFor(text) === undefined,
  );
  for (const transformation of unresolvedTransformations)
    issues.push(
      issueFor(
        npc,
        "unresolved-transformation",
        `Transformation is unresolved: ${transformation}.`,
      ),
    );
  if (profile?.battleNotes?.trim())
    issues.push(
      issueFor(
        npc,
        "unsupported-battle-note",
        "Mechanical battle notes require structured ownership.",
      ),
    );

  const row: NpcReadinessRow = {
    npcId: npc.id,
    sourceReference: npc.source,
    hpStatus,
    powerStatus,
    dexterityStatus,
    dexterityBonusStatus,
    ...(race === undefined ? {} : { raceReference: race.id }),
    ...(styleId === undefined ? {} : { styleReference: styleId }),
    resolvedMoves: [...npc.moveIds],
    unresolvedMoves,
    resolvedItems: [...new Set(resolvedItems)],
    unresolvedItems,
    resolvedTransformations: [...new Set(resolvedTransformations)],
    unresolvedTransformations,
    battleNotesStatus: profile?.battleNotes?.trim() ? "unsupported" : "none",
    runtimeClassification: issues.length === 0 ? "automated" : "manual-only",
    ...(effectivePolicyId === undefined ? {} : { effectivePolicyId }),
    issues,
    testEvidence: ["assessNpcReadiness", "materializeNpcCombatant"],
  };
  return issues.length === 0 ? { ok: true, value: row } : { ok: false, row };
};

export const npcReadinessMatrix = (
  effectivePolicyFor?: (npcId: NpcId) => string | undefined,
): readonly NpcReadinessRow[] =>
  NPC_DEFINITIONS.map((npc) => {
    const policyId = effectivePolicyFor?.(npc.id);
    const result = assessNpcReadiness(npc, normalizationOverlayFor(npc.id), policyId);
    return result.ok ? result.value : result.row;
  });

export const materializeNpcCombatant = (npcId: NpcId): NpcCombatantMaterialization => {
  const npc = NPC_DEFINITIONS.find((candidate) => candidate.id === npcId);
  if (npc === undefined)
    return {
      ok: false,
      npcId,
      issues: [
        {
          reason: "missing-combat-profile",
          message: `Unknown NPC: ${npcId}.`,
          sourceReference: { path: "game-data", text: npcId },
        },
      ],
    };
  const overlay = normalizationOverlayFor(npcId);
  const readiness = assessNpcReadiness(npc, overlay);
  if (!readiness.ok) return { ok: false, npcId, issues: readiness.row.issues };
  const profile = npc.combatProfile!;
  const race = raceFor(npc, overlay);
  const styleId = styleIdFor(npc, overlay);
  const dexterityBonus = dexterityBonusFor(overlay?.dexterityAllocationPercent)!;
  const transformations =
    profile.transformationText === undefined ? [] : [profile.transformationText];
  const transformationProfiles = transformations.map((text) => ({
    transformationId: transformationFor(text)!.id,
    rollSides: transformationRollSidesFor(text) ?? 20,
    mastery: "novice" as const,
  }));
  return {
    ok: true,
    value: {
      maximumHitPoints: numericValue(profile.hitPoints)!,
      stats: {
        power: numericValue(profile.power)!,
        dexterity: numericValue(profile.dexterity)!,
        dexterityBonus: Math.max(
          GLOBAL_RULES.combat.minimumDexterityBonus,
          Math.min(GLOBAL_RULES.combat.maximumDexterityBonus, dexterityBonus),
        ),
      },
      ...(race === undefined ? {} : { raceId: race.id }),
      ...(styleId === undefined ? {} : { declaredStyleId: styleId }),
      ...(overlay?.classId === undefined ? {} : { classId: overlay.classId }),
      ...(overlay?.raceTraitIds === undefined ? {} : { raceTraitIds: [...overlay.raceTraitIds] }),
      moveIds: [...npc.moveIds],
      ...(readiness.value.resolvedItems.length === 0
        ? {}
        : { itemIds: [...readiness.value.resolvedItems] }),
      ...(transformationProfiles.length === 0
        ? {}
        : {
            transformationIds: transformationProfiles.map(
              (candidate) => candidate.transformationId,
            ),
            transformationProfiles,
          }),
    },
  };
};

/* eslint-enable sonarjs/cognitive-complexity, complexity */
