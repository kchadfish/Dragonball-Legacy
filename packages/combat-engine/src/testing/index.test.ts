import { describe, expect, it } from "vitest";

import {
  activeEffectIdSchema,
  combatDecisionIdSchema,
  combatEventIdSchema,
  combatantIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
} from "../index.js";
import {
  createTestCombatDependencies,
  FixedClock,
  SequenceCombatIdSource,
  SequenceRandomSource,
} from "./index.js";

describe("combat-engine testing dependencies", () => {
  it("replays random values and rejects invalid sequence values", () => {
    const random = new SequenceRandomSource([4]);
    const outOfRangeRandom = new SequenceRandomSource([9]);

    expect(random.integer(1, 6)).toBe(4);
    expect(() => outOfRangeRandom.integer(1, 6)).toThrow(RangeError);
    expect(() => new SequenceRandomSource([]).integer(1, 6)).toThrow("exhausted");
  });

  it("returns a defensive clock value", () => {
    const clock = new FixedClock(new Date("2026-08-04T12:00:00.000Z"));
    const firstRead = clock.now();
    firstRead.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe("2026-08-04T12:00:00.000Z");
  });

  it("provides deterministic typed IDs and dependency bundles", () => {
    const ids = new SequenceCombatIdSource({
      activeEffectIds: [activeEffectIdSchema.parse("active-effect:burning")],
      combatantIds: [combatantIdSchema.parse("combatant:goku")],
      decisionIds: [combatDecisionIdSchema.parse("decision:pass")],
      eventIds: [combatEventIdSchema.parse("event:turn-started")],
      fightIds: [fightIdSchema.parse("fight:opening-spar")],
      pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:reaction")],
    });

    expect(ids.nextFightId()).toBe("fight:opening-spar");
    expect(ids.nextCombatantId()).toBe("combatant:goku");
    expect(ids.nextDecisionId()).toBe("decision:pass");
    expect(ids.nextEventId()).toBe("event:turn-started");
    expect(ids.nextPendingDecisionId()).toBe("pending-decision:reaction");
    expect(ids.nextActiveEffectId()).toBe("active-effect:burning");
    expect(() => ids.nextFightId()).toThrow("fightIds");

    const dependencies = createTestCombatDependencies([5], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:second-spar")],
    });
    expect(dependencies.random.integer(1, 6)).toBe(5);
    expect(dependencies.ids.nextFightId()).toBe("fight:second-spar");
  });
});
