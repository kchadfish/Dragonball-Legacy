import { describe, expect, it } from "vitest";

import { KUROKONWAKU_MOVES } from "./kurokonwaku.js";

describe("KUROKONWAKU_MOVES", () => {
  it("records Flashback's last unrestricted attack replay", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Flashback")?.effects).toEqual([
      expect.objectContaining({
        type: "copy-move-effect",
        sourceMove: expect.objectContaining({ type: "last-prior-move" }),
        damage: { type: "add-percent", value: { type: "literal", value: 10 } },
      }),
    ]);
  });

  it("records Breaking The Cycle's paired unrestricted successful-effect suppression", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Breaking The Cycle")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "suppress",
          target: "self",
          aspects: ["successful-effects"],
        }),
        expect.objectContaining({
          type: "suppress",
          target: "opponent",
          aspects: ["successful-effects"],
        }),
      ]),
    );
  });

  it("records Trickster Mastery's permanent penalties and physical-energy branches", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Trickster Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "attack" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
        expect.objectContaining({ type: "deactivate" }),
        expect.objectContaining({ type: "prevent-resource-modification", resource: "hp" }),
        expect.objectContaining({ type: "prevent-resource-modification", resource: "ki" }),
      ]),
    );
  });

  it("represents rerolls, threshold branches, and result-gated locks", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Second Chance")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reroll", roll: "defense" }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 5 } }),
      ]),
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Firebreath")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: { type: "literal", value: 1 } }),
        expect.objectContaining({ amount: { type: "literal", value: 2 } }),
      ]),
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Empty Beam")?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "lock", affectedType: "power-up" })]),
    );
  });

  it("records status gates and next-move roll replacements", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Eggsplosives")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Proximity Blast")?.effects).toEqual([
      expect.objectContaining({ type: "set-roll-definition", roll: "attack", dice: 1, sides: 35 }),
    ]);
  });

  it("captures long-lived locks and stopped-result resource effects", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Concussion Shot")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        duration: expect.objectContaining({ type: "combat" }),
      }),
    ]);
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Black Hole Slam")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", trigger: "on-stopped", resource: "hp" }),
    ]);
  });
  it("records Poison Mist's recurring upkeep KI drain", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Poison Mist")?.effects).toEqual([
      expect.objectContaining({
        type: "schedule-effect",
        repeat: "each-turn",
        effect: expect.objectContaining({ resource: "ki", operation: "drain" }),
      }),
    ]);
  });

  it("models After-Image Mastery's single-die KI drain thresholds", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "After-Image Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          trigger: "after-defense-roll",
          conditions: expect.arrayContaining([
            expect.objectContaining({ type: "roll-comparison" }),
          ]),
        }),
      ]),
    );
  });

  it("records Kick Them When They're Down's consecutive-stop KI drain", () => {
    expect(
      KUROKONWAKU_MOVES.find((move) => move.name === "Kick Them When They're Down")?.effects,
    ).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "ki",
        amount: { type: "literal", value: 2 },
        conditions: [expect.objectContaining({ type: "action-sequence" })],
      }),
    ]);
  });

  it("records Burrowing Beam's non-Bukujutsu roll penalties", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Burrowing Beam")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          roll: "attack",
          amount: { type: "literal", value: -4 },
        }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "defense",
          amount: { type: "literal", value: -4 },
        }),
      ]),
    );
  });

  it("records Dismissive Kick's selected successful-effect suppression", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Dismissive Kick")?.effects).toEqual([
      expect.objectContaining({ type: "suppress", aspects: ["successful-effects"] }),
    ]);
  });

  it("records Dark Energy Spiral's next unrestricted attack cost increase", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Dark Energy Spiral")?.effects).toEqual([
      expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } }),
    ]);
  });

  it("records Squeezebox's selected constant-skill deactivation", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Squeezebox")?.effects).toEqual([
      expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
    ]);
  });

  it("records Cursed Spheres' all-hit attack and defense penalties", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Cursed Spheres")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "attack" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
      ]),
    );
  });

  it("records Purple People Skewer's per-hit drain and Sand In The Eyes' penalty", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Purple People Skewer")?.effects).toEqual(
      [
        expect.objectContaining({
          type: "modify-resource",
          amount: { type: "successful-hit-count", perHit: 1 },
        }),
      ],
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Sand In The Eyes")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: -4 } }),
    ]);
  });

  it("records Ear Piercer's unblockability and Aerial Maneuvers' next cost", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Ear Piercer")?.effects).toEqual([
      expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
    ]);
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Aerial Maneuvers")?.effects).toEqual([
      expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: -1 } }),
    ]);
  });

  it("records Psycho Driver's next-attack total-damage follow-up", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Psycho Driver")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        amount: { type: "damage-percent", subject: "current-action", percent: 20 },
      }),
    ]);
  });

  it("records Dance With The Devil's constant-skill deactivation and lock", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Dance With The Devil")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deactivate",
          selector: expect.objectContaining({ constant: true }),
        }),
        expect.objectContaining({ type: "lock", affectedType: "skill" }),
      ]),
    );
  });

  it("records Fade To Black's attack and defense d20 duration", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Fade To Black")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-roll-definition",
          roll: "attack",
          sides: 20,
          duration: expect.objectContaining({ type: "until-combat-result" }),
        }),
        expect.objectContaining({ type: "set-roll-definition", roll: "defense", sides: 20 }),
      ]),
    );
  });

  it("records Energy Lob and Sixty Second Meltdown's action follow-up", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Energy Lob")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", roll: "attack" }),
    ]);
    expect(
      KUROKONWAKU_MOVES.find((move) => move.name === "Sixty Second Meltdown")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "grant-extra-action",
          activationGroup: "sixty-second-meltdown-extra-actions",
        }),
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: -1 } }),
      ]),
    );
  });

  it("records Darkness Buster's four roll penalties until a successful attack", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Darkness Buster")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "attack", modifier: "sides" }),
        expect.objectContaining({ type: "modify-roll", roll: "attack", modifier: "result" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense", modifier: "sides" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense", modifier: "result" }),
      ]),
    );
  });

  it("records Mirage's stopped-attack lock", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Mirage")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        affectedType: "attack",
        duration: expect.objectContaining({
          type: "turns",
          turns: { type: "literal", value: 1 },
        }),
      }),
    ]);
  });

  it("records Go Boom's non-lethal HP loss", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Go Boom!")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        cap: expect.objectContaining({ type: "minimum", value: { type: "literal", value: 1 } }),
      }),
    ]);
  });

  it("records Smokescreen's energy-block KI loss follow-up", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Smokescreen")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        trigger: "on-success",
        resource: "ki",
        scope: expect.objectContaining({ type: "next-action" }),
      }),
    ]);
  });

  it("records Setting Up The Punchline's named-move result bonuses", () => {
    expect(
      KUROKONWAKU_MOVES.find((move) => move.name === "Setting Up The Punchline")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          selector: expect.objectContaining({
            ids: expect.arrayContaining(["move-kurokonwaku-concussion-shot"]),
          }),
        }),
      ]),
    );
  });

  it("records Bloodletter's two-turn additional KI drain", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Bloodletter")?.effects).toEqual([
      expect.objectContaining({
        trigger: "on-resource-drain",
        type: "modify-resource",
        amount: { type: "literal", value: 1 },
        duration: expect.objectContaining({
          type: "turns",
          turns: { type: "literal", value: 2 },
        }),
      }),
    ]);
  });

  it("records Tesla Coil's equalizing drain and conditional follow-up", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Tesla Coil")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", operation: "set", resource: "ki" }),
        expect.objectContaining({
          type: "modify-roll",
          selector: expect.objectContaining({
            effectKinds: ["resource-loss", "roll-side-reduction"],
          }),
        }),
      ]),
    );
  });

  it("records Power Drain's temporary opponent racial traits", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Power Drain")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-racial-traits",
        source: "opponent",
        duration: expect.objectContaining({ type: "turns" }),
      }),
    ]);
  });

  it("records Manipulation Mastery's result-swapping timing", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Manipulation Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-combat-result", result: "stopped" }),
        expect.objectContaining({ type: "set-combat-result", result: "successful" }),
      ]),
    );
  });

  it("records Childish Taunt, Killer Gaze, and Living Voodoo's conditional effects", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Childish Taunt")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        trigger: "on-resource-drain",
        duration: expect.objectContaining({ type: "turns-or-until-perfect-roll" }),
        stacking: "prevent",
      }),
    ]);
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Killer Gaze")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", trigger: "on-resource-gain" }),
        expect.objectContaining({ type: "prevent-move-use", operation: "deactivate" }),
      ]),
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Living Voodoo")?.effects).toEqual([
      expect.objectContaining({ type: "set-combat-result", result: "stopped" }),
    ]);
  });

  it("records Dimension Scream's attack-effect suppression branches", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Dimension Scream")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "suppress",
          aspects: ["all-effects"],
          duration: expect.objectContaining({ type: "until-roll-threshold" }),
        }),
      ]),
    );
  });

  it("records Shadow Stalker's conditional activation and restricted-target protection", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Shadow Stalker")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "activate", trigger: "on-success" }),
        expect.objectContaining({ type: "prevent-move-use", target: "self" }),
        expect.objectContaining({ type: "modify-cost" }),
      ]),
    );
  });

  it("records Control Mastery's chosen-move cost, defense, and cooldown effects", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Control Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 2 } }),
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
        expect.objectContaining({ type: "apply-status", statusId: "cooldown" }),
      ]),
    );
  });

  it("records Cancellation Mastery's Kurokonwaku success mastery lock", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Cancellation Mastery")?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "lock", affectedType: "mastery" })]),
    );
  });

  it("records Cancellation Master's reactive cancellation branches and minimum cost", () => {
    const effects = KUROKONWAKU_MOVES.find((move) => move.name === "Cancellation Mastery")?.effects;

    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger: "on-move-use",
          type: "deactivate",
          selector: expect.objectContaining({ category: "skill", constant: true }),
          activationCost: expect.objectContaining({ minimum: { type: "literal", value: 1 } }),
        }),
        expect.objectContaining({
          trigger: "on-move-use",
          type: "negate",
          selector: expect.objectContaining({ category: "skill", constant: false }),
          activationCost: expect.objectContaining({ minimum: { type: "literal", value: 1 } }),
        }),
        expect.objectContaining({
          trigger: "on-combat-result",
          type: "negate",
          conditions: [expect.objectContaining({ type: "combat-outcome", outcome: "critical" })],
        }),
      ]),
    );
  });

  it("records Mimicry Master's effect exchange and once-per-combat borrowed attack", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Mimicry Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "copy-move-effects", sourceEffectResult: "successful" }),
        expect.objectContaining({
          type: "copy-move-effect",
          ignoreRequirements: true,
          useLimit: expect.objectContaining({ scope: "combat", count: 1 }),
        }),
      ]),
    );
  });

  it("records Puppet Master, Ki Trap, and Spiked Ball's selected-move mechanics", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Puppet Master")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "force-action", fallback: "basic-attack" }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: -2 } }),
      ]),
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Ki Trap")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "roll-and-store", dice: 1, sides: 30 }),
        expect.objectContaining({ type: "modify-resource", prevention: "prohibited" }),
        expect.objectContaining({
          type: "reroll",
          exclusiveActivationGroup: "ki-trap-self-reroll",
        }),
      ]),
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Spiked Ball")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-remaining-uses" }),
        expect.objectContaining({ type: "replace-move-effect", remove: "source-effect" }),
      ]),
    );
  });

  it("records Vampiric Lust's terminating Ki siphon and Sweet Dreams' lock", () => {
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Vampiric Lust")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "vampiric-lust-ki-siphon",
          termination: expect.arrayContaining([
            expect.objectContaining({ trigger: "on-power-up" }),
          ]),
        }),
      ]),
    );
    expect(KUROKONWAKU_MOVES.find((move) => move.name === "Sweet Dreams")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", minimum: { type: "literal", value: 3 } }),
        expect.objectContaining({
          type: "lock",
          affectedType: "power-up",
          duration: expect.objectContaining({ type: "until-turn-start-roll-threshold" }),
        }),
      ]),
    );
  });
});
