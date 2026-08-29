import { describe, expect, it } from "vitest";

import {
  activeEffectIdSchema,
  combatDecisionIdSchema,
  combatEventIdSchema,
  combatantIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
  scheduledWorkIdSchema,
  SystemCombatIdSource,
  SystemRandomSource,
  SeededRandomSource,
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

  it("replays seeded randomness while system randomness respects requested bounds", () => {
    const first = new SeededRandomSource(42);
    const second = new SeededRandomSource(42);
    const system = new SystemRandomSource();

    expect([first.integer(1, 30), first.integer(1, 30), first.integer(1, 30)]).toEqual([
      second.integer(1, 30),
      second.integer(1, 30),
      second.integer(1, 30),
    ]);
    expect(system.integer(4, 4)).toBe(4);
    expect(() => new SeededRandomSource(-1)).toThrow(RangeError);
    expect(() => first.integer(2, 1)).toThrow(RangeError);
  });

  it("provides deterministic typed IDs and dependency bundles", () => {
    const ids = new SequenceCombatIdSource({
      activeEffectIds: [activeEffectIdSchema.parse("active-effect:burning")],
      combatantIds: [combatantIdSchema.parse("combatant:goku")],
      decisionIds: [combatDecisionIdSchema.parse("decision:pass")],
      eventIds: [combatEventIdSchema.parse("event:turn-started")],
      fightIds: [fightIdSchema.parse("fight:opening-spar")],
      pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:reaction")],
      resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:attack")],
      scheduledWorkIds: [scheduledWorkIdSchema.parse("scheduled-work:extra-action")],
    });

    expect(ids.nextFightId()).toBe("fight:opening-spar");
    expect(ids.nextCombatantId()).toBe("combatant:goku");
    expect(ids.nextDecisionId()).toBe("decision:pass");
    expect(ids.nextEventId()).toBe("event:turn-started");
    expect(ids.nextPendingDecisionId()).toBe("pending-decision:reaction");
    expect(ids.nextActiveEffectId()).toBe("active-effect:burning");
    expect(ids.nextResolutionFrameId()).toBe("resolution-frame:attack");
    expect(ids.nextScheduledWorkId()).toBe("scheduled-work:extra-action");
    expect(() => ids.nextFightId()).toThrow("fightIds");

    const dependencies = createTestCombatDependencies([5], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:second-spar")],
    });
    expect(dependencies.random.integer(1, 6)).toBe(5);
    expect(dependencies.ids.nextFightId()).toBe("fight:second-spar");
  });

  it("creates valid namespaced production IDs", () => {
    const ids = new SystemCombatIdSource();

    expect(fightIdSchema.safeParse(ids.nextFightId()).success).toBe(true);
    expect(combatantIdSchema.safeParse(ids.nextCombatantId()).success).toBe(true);
    expect(combatDecisionIdSchema.safeParse(ids.nextDecisionId()).success).toBe(true);
    expect(combatEventIdSchema.safeParse(ids.nextEventId()).success).toBe(true);
    expect(pendingDecisionIdSchema.safeParse(ids.nextPendingDecisionId()).success).toBe(true);
    expect(activeEffectIdSchema.safeParse(ids.nextActiveEffectId()).success).toBe(true);
    expect(resolutionFrameIdSchema.safeParse(ids.nextResolutionFrameId()).success).toBe(true);
    expect(scheduledWorkIdSchema.safeParse(ids.nextScheduledWorkId()).success).toBe(true);
  });
});
