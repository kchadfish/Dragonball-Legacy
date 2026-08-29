import { describe, expect, it } from "vitest";

import { classifyCombatResult } from "./index.js";

const base = {
  diceCount: 1,
  diceSides: 30,
  naturalAttackResult: 30,
  naturalDefenseResult: 30,
  attackerDexterity: 1,
  defenderDexterity: 0,
};

describe("combat result classification", () => {
  it("retains the initially triggered result when the final result changes", () => {
    expect(
      classifyCombatResult({
        ...base,
        initiallyTriggeredResult: "stopped",
        finalResult: "successful",
      }),
    ).toEqual({
      initiallyTriggeredResult: "stopped",
      finalResult: "successful",
      kind: "critical",
      critical: true,
      counter: false,
    });
  });

  it("applies prevention after final outcome calculation", () => {
    expect(
      classifyCombatResult({
        ...base,
        initiallyTriggeredResult: "successful",
        finalResult: "successful",
        criticalPrevented: true,
      }),
    ).toMatchObject({ kind: "successful", critical: false, counter: false });
    expect(
      classifyCombatResult({
        ...base,
        initiallyTriggeredResult: "successful",
        finalResult: "stopped",
        counterPrevented: false,
      }),
    ).toMatchObject({ kind: "counter", critical: false, counter: true });
  });

  it("does not classify blocked dice as successful or critical", () => {
    expect(
      classifyCombatResult({
        ...base,
        initiallyTriggeredResult: "blocked",
        finalResult: "blocked",
      }),
    ).toMatchObject({ kind: "blocked", critical: false, counter: false });
  });
});
