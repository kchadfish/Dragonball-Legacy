import { AFTERLIFE_MOVES } from "./moves/afterlife.js";
import { AKAIKARU_MOVES } from "./moves/akaikaru.js";
import { AOYOSUMU_MOVES } from "./moves/aoyosumu.js";
import { FREESTYLE_MOVES } from "./moves/freestyle.js";
import { HAOKIRU_MOVES } from "./moves/haokiru.js";
import { KIIHAKAI_MOVES } from "./moves/kiihakai.js";
import { KUROKONWAKU_MOVES } from "./moves/kurokonwaku.js";
import { MIDORIKATAI_MOVES } from "./moves/midorikatai.js";
import type { MoveDefinition } from "./shared/types.js";

const allMoves: readonly MoveDefinition[] = [
  ...AFTERLIFE_MOVES,
  ...AKAIKARU_MOVES,
  ...AOYOSUMU_MOVES,
  ...FREESTYLE_MOVES,
  ...HAOKIRU_MOVES,
  ...KIIHAKAI_MOVES,
  ...KUROKONWAKU_MOVES,
  ...MIDORIKATAI_MOVES,
];

const ids = (values: readonly string[]) => new Set(values);

const constantMoveIds = ids([
  "move-afterlife-energy-blade",
  "move-akaikaru-relentless",
  "move-akaikaru-impulsive",
  "move-aoyosumu-close-shave",
  "move-aoyosumu-inner-peace",
  "move-aoyosumu-state-of-zen",
  "move-freestyle-effortless",
  "move-freestyle-expert-swordplay",
  "move-freestyle-monkey-maneuvers",
  "move-freestyle-protecting-your-vitality",
  "move-freestyle-unquenchable-bloodthirst",
  "move-freestyle-way-of-the-gun",
  "move-freestyle-predictable",
  "move-haokiru-advanced-behavior",
  "move-haokiru-energy-absorption",
  "move-haokiru-high-threshold",
  "move-kiihakai-evening-the-field",
  "move-kiihakai-redirected-energy",
  "move-kiihakai-eagle-eye",
  "move-kiihakai-energy-gathering",
  "move-kiihakai-focus-breaker",
  "move-kiihakai-ki-shield",
  "move-kiihakai-overload",
  "move-kiihakai-power-boost",
  "move-kiihakai-power-deflection",
  "move-kiihakai-synergy",
  "move-kiihakai-protective-aura",
  "move-kurokonwaku-childish-taunt",
  "move-kurokonwaku-killer-gaze",
  "move-kurokonwaku-puppet-master",
  "move-kurokonwaku-shadow-stalker",
]);

const dexterityMoveIds = ids([
  "move-afterlife-kaio-ken",
  "move-afterlife-meteor-smash",
  "move-afterlife-kaio-ken-attack",
  "move-afterlife-burst-rush",
  "move-afterlife-rolling-satan-punch",
  "move-afterlife-super-big-bang-attack",
  "move-afterlife-space-mach-attack",
  "move-afterlife-eraser-cannon",
  "move-akaikaru-swift-reaction",
  "move-akaikaru-speed-demon",
  "move-akaikaru-agile-medley",
  "move-akaikaru-backflip-kick",
  "move-akaikaru-dexterous-glaive",
  "move-akaikaru-pressure-cooker",
  "move-akaikaru-shotgun-blast",
  "move-akaikaru-stampede-rush",
  "move-akaikaru-blitzkrieg",
  "move-akaikaru-naginata",
  "move-akaikaru-sonic-boom",
  "move-akaikaru-hypersonic-knockout",
  "move-akaikaru-great-finale",
  "move-akaikaru-dazzling-gymnastics",
  "move-aoyosumu-swift-neck-chop",
  "move-aoyosumu-push",
  "move-aoyosumu-serenity-explosion",
  "move-aoyosumu-blast-shield",
  "move-freestyle-monkey-maneuvers",
  "move-freestyle-baton-twirl",
  "move-freestyle-dragon-rush",
  "move-kiihakai-sledgehammer",
  "move-kurokonwaku-darkness-choke",
  "move-midorikatai-knee-stomp",
  "move-midorikatai-rocket-fire",
  "move-midorikatai-leg-vice",
]);

const powerUpMoveIds = ids([
  "move-afterlife-future-sight",
  "move-afterlife-burning-attack",
  "move-afterlife-destructo-disc",
  "move-afterlife-kienzan",
  "move-afterlife-evil-flame",
  "move-afterlife-evil-impulse",
  "move-akaikaru-continuous-knee-smash",
  "move-akaikaru-jackknife-beam",
  "move-aoyosumu-calming-mastery",
  "move-freestyle-straining-aura-explosion",
  "move-haokiru-reserves",
  "move-haokiru-dragon-blast",
  "move-haokiru-rapture",
  "move-kiihakai-overdrive-mastery",
  "move-kiihakai-power-surge-mastery",
  "move-kiihakai-ki-barbs",
  "move-kiihakai-heavy-jolt",
  "move-kiihakai-ki-jammer",
  "move-kiihakai-display-of-power",
  "move-kiihakai-heat-seeking-blast",
  "move-kiihakai-golden-arrows",
  "move-kiihakai-energy-slasher",
  "move-kurokonwaku-darkness-choke",
  "move-kurokonwaku-empty-beam",
  "move-kurokonwaku-squeezebox",
  "move-kurokonwaku-vampiric-lust",
  "move-kurokonwaku-shadow-realm",
  "move-kurokonwaku-sweet-dreams",
]);

const requirementTagGroups: readonly (readonly [string, ReadonlySet<string>])[] = [
  [
    "bukujutsu",
    ids([
      "move-afterlife-kaio-ken-attack",
      "move-afterlife-final-revenger",
      "move-afterlife-burst-rush",
      "move-afterlife-burning-shoot",
      "move-afterlife-rolling-satan-punch",
      "move-afterlife-thunder-flash",
      "move-afterlife-gigantic-hammer",
      "move-afterlife-gigantic-meteor",
      "move-afterlife-space-mach-attack",
      "move-akaikaru-stampede-rush",
      "move-akaikaru-volcanic-smash",
      "move-akaikaru-blitzkrieg",
      "move-akaikaru-delta-storm",
      "move-akaikaru-great-finale",
      "move-akaikaru-scorched-earth",
      "move-aoyosumu-return-fire",
      "move-aoyosumu-crushing-kick",
      "move-aoyosumu-tears-of-the-mystic",
      "move-aoyosumu-heavenly-execution",
      "move-aoyosumu-serenity-explosion",
      "move-freestyle-multitasking-kick",
      "move-freestyle-all-out-triumphant-beam",
      "move-freestyle-sword-dance",
      "move-haokiru-dragon-spiral",
      "move-haokiru-phoenix-tackle",
      "move-haokiru-warped-ray",
      "move-haokiru-focused-spirit-cutter",
      "move-kiihakai-eagle-eye",
      "move-kiihakai-heavy-jolt",
      "move-kiihakai-aerial-beam",
      "move-kiihakai-diving-elbow",
      "move-kiihakai-downward-spiral",
      "move-kiihakai-big-shot",
      "move-kiihakai-shooting-star",
      "move-kurokonwaku-surprise",
      "move-midorikatai-enraged-piledriver",
      "move-midorikatai-flapjack",
      "move-midorikatai-rocket-fire",
      "move-midorikatai-smackdown",
      "move-midorikatai-gorilla-press",
      "move-midorikatai-falling-star-charge",
      "move-midorikatai-galactic-punisher",
    ]),
  ],
  [
    "weapon",
    ids([
      "move-afterlife-sword-blast",
      "move-freestyle-monkey-maneuvers",
      "move-freestyle-suppressive-fire",
      "move-freestyle-monkey-sweep",
      "move-freestyle-pistol-whip",
      "move-freestyle-sternum-crusher",
      "move-freestyle-sword-riposte",
      "move-freestyle-tricky-sword-maneuvers",
      "move-freestyle-baton-twirl",
      "move-freestyle-bullet-ballet",
      "move-freestyle-explosive-round",
      "move-freestyle-heart-stab",
      "move-freestyle-sword-dance",
      "move-freestyle-thwack",
      "move-freestyle-batter-up-blitz",
      "move-freestyle-cannons-sparking",
      "move-freestyle-slice-n-hack",
      "move-freestyle-crossing-iron",
    ]),
  ],
  [
    "sword",
    ids([
      "move-afterlife-burning-slash",
      "move-afterlife-sword-blast",
      "move-afterlife-blade-rush",
      "move-freestyle-expert-swordplay",
      "move-freestyle-sword-riposte",
      "move-freestyle-tricky-sword-maneuvers",
      "move-freestyle-heart-stab",
      "move-freestyle-sword-dance",
      "move-freestyle-slice-n-hack",
    ]),
  ],
  [
    "gun",
    ids([
      "move-afterlife-super-galick-gun",
      "move-freestyle-way-of-the-gun",
      "move-freestyle-suppressive-fire",
      "move-freestyle-pistol-whip",
      "move-freestyle-bullet-ballet",
      "move-freestyle-explosive-round",
      "move-freestyle-cannons-sparking",
    ]),
  ],
  [
    "blunt weapon",
    ids([
      "move-freestyle-monkey-maneuvers",
      "move-freestyle-monkey-sweep",
      "move-freestyle-sternum-crusher",
      "move-freestyle-baton-twirl",
      "move-freestyle-thwack",
      "move-freestyle-batter-up-blitz",
    ]),
  ],
];

const titleTagGroups: readonly (readonly [string, ReadonlySet<string>])[] = [
  [
    "straining",
    ids([
      "move-freestyle-straining-aura-explosion",
      "move-freestyle-straining-bodyslam",
      "move-freestyle-straining-knockback",
      "move-freestyle-straining-power-drain",
      "move-freestyle-straining-concussion-wave",
      "move-freestyle-straining-distraction-burst",
    ]),
  ],
  ["swordplay", ids(["move-freestyle-expert-swordplay"])],
];

const requirementTagsFor = (move: MoveDefinition): readonly string[] =>
  requirementTagGroups.flatMap(([tag, moveIds]) => (moveIds.has(move.id) ? [tag] : []));

const effectRuleTokensFor = (move: MoveDefinition): readonly string[] => [
  ...(dexterityMoveIds.has(move.id) ? ["dexterity"] : []),
  ...(powerUpMoveIds.has(move.id) ? ["power-up"] : []),
];

/** Static, typed title classifications used by selectors; source text remains display-only. */
export const MOVE_DEFINITIONS: readonly MoveDefinition[] = allMoves.map((move) => {
  const activationClassification =
    move.category === "skill" && constantMoveIds.has(move.id) ? ("constant" as const) : undefined;
  const titleTags = titleTagGroups.flatMap(([tag, moveIds]) => (moveIds.has(move.id) ? [tag] : []));
  const requirementTags = requirementTagsFor(move);
  const effectRuleTokens = effectRuleTokensFor(move);
  return titleTags.length === 0 &&
    requirementTags.length === 0 &&
    effectRuleTokens.length === 0 &&
    activationClassification === undefined
    ? move
    : {
        ...move,
        mechanics: {
          ...move.mechanics,
          ...(titleTags.length === 0 ? {} : { titleTags }),
          ...(requirementTags.length === 0 ? {} : { requirementTags }),
          ...(effectRuleTokens.length === 0 ? {} : { effectRuleTokens }),
          ...(activationClassification === undefined ? {} : { activationClassification }),
        },
      };
});
