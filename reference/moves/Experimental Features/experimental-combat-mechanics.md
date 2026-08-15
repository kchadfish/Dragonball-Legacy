# Experimental Combat Mechanics

These mechanics are intentionally deferred until balance testing.

They should not block completion of the current combat engine or existing move catalog. Each mechanic should be introduced only when balance testing identifies a move, style, or gameplay problem that the mechanic could meaningfully solve.

When one is tested, begin with a small number of moves, implement only the minimum reusable engine support required, and evaluate the mechanic before expanding it elsewhere.

---

## Charge

### Concept

**Charge** allows a move to accumulate power over time before releasing or consuming that stored power for a stronger effect.

Unlike Power Up, Charge is tied to a specific move or effect rather than increasing the character's general Ki resources.

Charge introduces a tradeoff between immediate value and delayed payoff.

### Design Goals

Charge can be used to:

- make powerful attacks require visible setup;
- create tension around whether a fighter can complete their preparation;
- give slower techniques greater payoff without simply increasing their Ki cost;
- reward players for planning several actions ahead;
- give opponents opportunities to disrupt or react to an incoming major attack;
- create techniques that become progressively stronger rather than being purely available/unavailable.

### Basic Structure

A move that creates Charge should define:

- what receives the Charge;
- how Charge is gained;
- the maximum amount of Charge that may be stored;
- how long Charge lasts;
- what causes Charge to be lost, if anything;
- whether Charge may be consumed partially or must be consumed entirely;
- what effect occurs when Charge is spent.

Example:

> Gain 1 CHARGE whenever you perform this Skill, to a maximum of 3. When you perform [Attack], you may consume all CHARGE gained from this Skill. That attack gains +X Damage for each CHARGE consumed.

### Possible Charge Patterns

#### Fixed Charge

A technique requires a specific number of Charges before it can be performed.

> Gain 1 CHARGE each time you perform this Skill. At 3 CHARGE, you may perform [Attack].

#### Scaling Charge

A move can be released early, but becomes stronger the longer it is charged.

> Before performing this attack, consume any amount of its CHARGE. Gain +X Damage for each CHARGE consumed.

#### Risky Charge

Charge can be disrupted.

> If you take damage before consuming this move's CHARGE, lose 1 CHARGE.

This creates counterplay without necessarily preventing the technique entirely.

#### Persistent Charge

Charge survives between turns until spent.

This is appropriate for techniques representing prolonged preparation.

#### Temporary Charge

Charge expires quickly.

> At the end of your next turn, remove all remaining CHARGE created by this effect.

This creates a narrower setup window.

### Balance Considerations

Charge should provide **better efficiency in exchange for time and risk**, not simply make an already-good attack stronger.

Important variables include:

- actions required to build Charge;
- maximum Charge;
- ease of disruption;
- whether the opponent knows what is being charged;
- how much benefit each Charge provides;
- whether Charge costs Ki in addition to requiring time;
- whether Charge can be carried indefinitely.

A fully charged technique should generally justify the opportunity cost required to reach it.

Charge should also avoid creating gameplay where the optimal strategy is repeatedly doing nothing while accumulating an unavoidable finishing attack.

### Possible Style Uses

Charge would fit especially well with:

- large Beam attacks;
- Kiihakai techniques;
- transformation-dependent attacks;
- finishing techniques;
- defensive techniques that build toward retaliation;
- moves representing meditation, concentration, or gathering energy.

### Possible Engine Primitive

Charge should probably not be implemented as a completely bespoke subsystem.

A reusable **Combat Meter** could represent Charge and later support other mechanics such as Momentum, Guard Strain, Stored Impact, Heat, or similar values.

Conceptually:

```ts
CombatMeter {
  id: string;
  ownerCombatantId: CombatantId;
  sourceDefinitionId: string;
  current: number;
  maximum?: number;
  targetCombatantId?: CombatantId;
  expiry?: MeterExpiry;
}
```

Possible effects could include:

- `create-meter`
- `modify-meter`
- `consume-meter`
- conditions based on meter value
- numeric expressions referencing meter value

The final architecture should be designed only when Charge is actually selected for balance testing.

---

## Barrier

### Concept

A **Barrier** is a temporary pool of protection that absorbs incoming damage before the protected fighter loses HP.

Unlike ordinary Defense bonuses or damage reduction, a Barrier represents a finite resource that can be worn down and destroyed.

Example:

> Create a 20 HP BARRIER. Damage dealt to you is dealt to the BARRIER before your HP. Remove the BARRIER when it reaches 0 HP.

### Design Goals

Barrier can:

- create defensive options other than increasing Defense Rolls;
- allow defensive techniques to protect against otherwise successful attacks;
- reward timing without permanently increasing survivability;
- allow opponents to break through defenses through sustained offense;
- create meaningful interaction with large attacks versus multiple weaker attacks;
- represent iconic Dragon Ball energy shields and protective auras.

### Basic Structure

A Barrier should define:

- its maximum durability;
- who it protects;
- which damage it can absorb;
- how long it lasts;
- whether multiple Barriers can coexist;
- what happens when damage exceeds its remaining durability;
- whether the Barrier can be restored;
- whether certain attacks bypass or interact differently with it.

Basic resolution:

```text
Incoming Damage: 30
Barrier Remaining: 20

Barrier loses 20.
Barrier is destroyed.
Combatant loses 10 HP.
```

### Barrier Variants

#### Standard Barrier

Absorbs all eligible incoming damage until destroyed.

#### Physical Barrier

Only absorbs PHYSICAL damage.

#### Energy Barrier

Only absorbs ENERGY damage.

#### One-Hit Barrier

Protects against one attack regardless of whether durability remains afterward.

#### Regenerating Barrier

Restores some durability under defined circumstances.

> At the beginning of your turn, restore 5 durability to this BARRIER.

This should be used cautiously because sustained regeneration can create defensive stalemates.

#### Sacrificial Barrier

The Barrier provides another benefit when destroyed.

> When this BARRIER is destroyed, gain 2 Ki.

#### Ally Barrier

Protects another combatant rather than the user.

This could become particularly relevant if team combat becomes more prominent.

### Barrier vs. Damage Reduction

Barrier should remain mechanically distinct from ordinary damage reduction.

Damage reduction:

> Reduce incoming damage by 5.

Barrier:

> You have a temporary 20-point resource. Damage removes that resource before removing HP.

This distinction matters because attacks can meaningfully wear a Barrier down.

### Interaction with Multiple Hits

Balance testing should determine whether multi-hit or VOLLEY attacks:

- deal their total damage to the Barrier normally;
- resolve each hit separately;
- receive special bonuses for breaking Barriers.

This should not be assumed until the existing damage model is evaluated during implementation.

### Barrier Stacking

Multiple simultaneous Barriers could quickly become difficult to understand and balance.

A likely starting rule would be:

> A combatant may have only one Barrier at a time unless an effect explicitly states otherwise.

Creating another Barrier could either:

- replace the existing Barrier;
- restore or increase the existing Barrier;
- fail while another Barrier exists.

This should be decided during testing.

### Balance Considerations

Barrier durability effectively functions as temporary HP, so its value must be evaluated carefully.

Its effective strength depends heavily on:

- duration;
- durability;
- activation cost;
- whether activating it consumes an action;
- whether it can be refreshed;
- whether it can absorb all damage types;
- whether the opponent can deliberately destroy it;
- whether excess damage carries through.

A Barrier with 30 durability is not automatically equivalent to healing 30 HP because the Barrier may expire unused, be restricted to certain attacks, or require advance setup.

That difference is where much of its design space comes from.

### Possible Style Uses

Barrier would fit naturally with:

- defensive styles;
- Ki control styles;
- Namekian techniques;
- Android or equipment-based defenses;
- high-level Energy Skills;
- emergency defensive reactions;
- techniques intended to defend allies.

### Possible Engine Primitive

Barrier would likely need first-class combat state rather than being represented solely as a status.

Conceptually:

```ts
BarrierState {
  id: string;
  ownerCombatantId: CombatantId;
  sourceDefinitionId: string;
  currentDurability: number;
  maximumDurability: number;
  damageFilter?: AttackSelector;
  expiry?: BarrierExpiry;
}
```

Damage resolution would then route eligible damage through the Barrier before HP.

Implementation should wait until balance testing establishes the exact requirements.

---

## Prediction

### Concept

**Prediction** allows a move to secretly record what its user believes an opponent will do in the future.

The prediction is submitted privately to the bot, stored in combat state, and revealed when its resolution condition occurs.

Prediction therefore creates gameplay based on reading another player's habits without requiring the player to publicly reveal their choice beforehand.

### Core Principle

Prediction is **not a universal combat action**.

A player may only make a Prediction when a move or effect grants one.

The sequence is:

1. A move creates a Prediction opportunity.
2. The bot privately asks the player to make the required selection.
3. The selection is stored in combat state.
4. The opponent continues playing normally.
5. The relevant opponent action occurs.
6. The engine compares that action against the Prediction.
7. The Prediction is revealed and its success or failure is resolved.

### Example

A player performs:

> **Read the Flow**  
> Secretly predict whether your opponent's next attack will be PHYSICAL or ENERGY. If correct, gain +X to your Defense Roll against that attack.

The bot privately prompts:

```text
Choose your Prediction:

PHYSICAL
ENERGY
```

The player chooses ENERGY.

The opponent still sees the move that was used, but does not see the selected Prediction.

If the opponent then performs an ENERGY attack:

```text
Prediction Revealed: ENERGY

Prediction successful.
```

The move's benefit resolves.

### Public vs. Private Information

Normal combat information remains public.

Players can still see things such as:

- which moves have been performed;
- attack types and tags when normally visible;
- combat results;
- damage;
- statuses;
- visible resources.

The hidden information is the **Prediction selection itself** until its reveal condition occurs.

This allows Prediction to reward players for observing patterns in information they legitimately possess.

### Prediction Scope

Prediction can vary in specificity.

Greater specificity can justify a stronger reward.

#### Broad Prediction

Examples:

- PHYSICAL or ENERGY;
- Attack or Power Up;
- Offensive or defensive action.

Broad predictions should generally provide smaller rewards because they are easier to make correctly.

#### Tag Prediction

Examples:

- PUNCH;
- KICK;
- BEAM;
- BLAST;
- VOLLEY;
- HOLD;
- THROW.

These require greater knowledge of the opponent's tendencies and can justify stronger effects.

#### Move Prediction

The player predicts a specific move.

> Secretly select one attack your opponent has already performed this combat. The next time they perform that attack, reveal this Prediction and gain [effect].

Exact-move Predictions can justify substantially stronger rewards because they are much more difficult to land.

### Prediction Duration

Different moves may use different reveal windows.

#### Next Action

> Predict your opponent's next action.

The Prediction resolves immediately after the opponent acts.

#### Next Attack

> Predict your opponent's next attack.

Power Up, Skills, and other non-attacks do not consume the Prediction.

#### Persistent Trap

> Secretly select one attack your opponent has already performed. The next time they perform that attack this combat, reveal this Prediction.

This creates a longer-term trap.

#### Timed Prediction

> This Prediction expires at the end of your next turn.

This prevents a prediction from remaining indefinitely.

### Known vs. Unknown Prediction

There are two potentially useful forms.

#### Known Prediction

The opponent knows that a move created a Prediction but does not know the selected answer.

Example:

> Your opponent is informed that you have made a Prediction.

This creates a deliberate bluffing and mind-game mechanic.

#### Concealed Prediction

The opponent is not explicitly told that a Prediction has been created beyond whatever information the move itself normally reveals.

Because the move itself is public, an opponent may still infer that a Prediction is possible if they know the move's effect.

This is better suited to effects representing instinct, observation, or quietly studying an opponent.

These should be treated as separate balance tools rather than assuming every Prediction works the same way.

### Possible Rewards

A correct Prediction might:

- increase a Defense Roll;
- increase an Attack Roll;
- reduce incoming damage;
- reduce a move's cost;
- gain Ki;
- apply a status;
- suppress an effect;
- grant a COUNTER;
- activate another effect;
- accumulate progress toward a stronger ability.

The strength of the reward should scale with the difficulty and risk of the Prediction.

### Prediction Chains

Prediction can also support longer-term playstyles.

Example:

> At the end of your turn, secretly predict whether your opponent's next attack will be PHYSICAL or ENERGY. Each correct Prediction grants 1 INSIGHT. At 3 INSIGHT, activate [effect].

This could allow a style to mechanically represent gradually understanding an opponent over the course of combat.

If such mechanics become common, INSIGHT would likely use the same general Combat Meter system proposed for Charge rather than requiring another bespoke resource.

### Balance Considerations

Prediction should reward genuine pattern recognition rather than random guessing.

Useful safeguards include:

- limiting predictions to moves or categories the opponent has already demonstrated;
- scaling reward with prediction specificity;
- requiring a move or resource expenditure to create the Prediction;
- limiting the number of active Predictions;
- ensuring failed Predictions have an opportunity cost;
- preventing extremely broad predictions from granting disproportionately strong rewards.

Exact-move Predictions should usually offer the largest payoff, while binary predictions should provide relatively modest benefits.

### Hidden-State Architecture

Prediction introduces an important distinction between **authoritative combat state** and **player-visible combat state**.

The engine should still store the secret selection in `FightState` so combat remains deterministic, serializable, and replayable.

However, player-facing systems should not expose hidden values belonging to another combatant.

Conceptually:

```ts
PredictionState {
  id: string;
  ownerCombatantId: CombatantId;
  targetCombatantId: CombatantId;
  sourceDefinitionId: string;
  selection: PredictionSelection;
  revealCondition: PredictionRevealCondition;
  expiry?: PredictionExpiry;
}
```

The bot or other interface should receive a player-safe projection rather than unrestricted access to information that player is not permitted to see.

This capability could eventually support other hidden mechanics such as:

- traps;
- secretly selected targets;
- concealed preparation;
- hidden move choices;
- delayed reveals.

Prediction should be the mechanic that creates the need for this infrastructure, not an excuse to build a large hidden-information system in advance.

---

# Balance-Testing Approach

Charge, Barrier, and Prediction should each begin as a **design hypothesis**.

Do not implement all three simultaneously.

For each mechanic:

1. Identify a balance or gameplay problem.
2. Determine whether the proposed mechanic actually addresses that problem.
3. Select a small group of existing moves that naturally support it.
4. Rewrite those moves experimentally.
5. Implement the smallest generic engine capability necessary.
6. Run balance tests against the existing versions.
7. Adjust both the mechanic and individual moves.
8. Retain the mechanic only if it creates better gameplay.
9. Expand it to additional moves only after the initial implementation proves successful.

The mechanics should remain optional additions to the combat system until testing demonstrates that they improve the game.
