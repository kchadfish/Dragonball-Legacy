# Normalization Decisions

This log records approved source corrections and unresolved content. It does
not replace the game rules in the domain reference files.

## ND-001 - Markdown remains human-readable

Status: Approved

Decision: Preserve rule prose and BBCode in Markdown. Do not require a formula
or effect DSL in the Markdown files. TypeScript definitions are structured and
reviewed against the relevant Markdown entry.

## ND-002 - Source structure

Status: Approved

Decision: Use field-based Markdown, with one file per domain or style and
explicit fields for each entry.

## ND-003 - Canonical terminology

Status: Approved

Decision: `Aoyosumu` and `Kiihakai` are the canonical style names. Remove
alternate spellings from the reference corpus rather than retaining aliases.

## ND-004 - Empty requirements

Status: Approved

Decision: Use `Requirements: None` for an entry with no requirements. Blank
requirements are invalid.

## ND-005 - Combat taxonomy

Status: Approved

Decision: Classify mechanics as combat results, statuses, or effect operations
using `data-authoring.md` before authoring their TypeScript definitions.

## ND-006 - Usage limits

Status: Approved

Decision: `RESTRICTED`, `USE`, once-per-turn, once-per-combat, and cooldowns
are distinct concepts in TypeScript. Markdown remains prose-oriented.

## ND-007 - Validation policy

Status: Approved

Decision: A source ambiguity or incomplete entry blocks TypeScript generation
for the affected entity until resolved.

## ND-008 - Duplicate display names

Status: Approved

Decision: Display names may repeat only within different scopes. Every
TypeScript ID remains unique and scoped to its entity type.

## ND-009 - NPC ownership

Status: Approved

Decision: NPCs are defined once and referenced by ID from quests and trainers.
Their human-readable Markdown context remains in the domain documents.

## ND-010 - Effect clause resolution

Status: Approved

Decision: Effect clauses resolve in their written order unless a clause
explicitly replaces, prevents, or delays another clause. `At the start of` and
`on your next turn` are triggers; `if` is a condition; `when` and `immediately
after` create delayed effects; and `instead of` is an alternate action.

## ND-011 - Duration counting

Status: Approved

Decision: A turn-count duration starts on the current turn. Each combatant's
turn counts unless the source explicitly says `your turns`. Once-per-combat
limits span the battle; once-per-week limits use real-world time.

## ND-012 - Selector evaluation

Status: Approved

Decision: Move selectors evaluate base move definitions, not modified combat
state.

## ND-013 - Modifier resolution

Status: Approved

Decision: Resolve additive modifiers, then multiplicative modifiers, then
caps. Modifiers stack by default, including modifiers from multiple sources,
unless the source states otherwise. `Instead` replaces the relevant prior
outcome. Cost floors apply after all reductions. A cap's scope is determined by
its wording: it may constrain one move, one effect benefit, or a global rule.

## ND-014 - Formula evaluation

Status: Approved

Decision: Evaluate variables when their clause resolves unless the source
creates a snapshot. Use normal rounding. Percent bases must be explicit;
ambiguous percent bases require a source correction. Per-hit effects count
successful hits. Apply caps and floors after the full formula. Stateful
variables read current combat state at resolution.

## ND-015 - Multi-die block resolution

Status: Approved

Decision: Blocking a multi-dice attack blocks half its attacks, rounded up.
The first half is blocked; the defender rolls against the remaining attacks.

## ND-016 - State ownership

Status: Approved

Decision: Body swaps and temporary combat permissions belong to combat state.
Travel changes persistent character location. Planet destruction is persistent
shared world state. Learning requirements use permanent progression data.
Once-per-week limits persist their last-use timestamp. `Bukujutsu` is a move
reference; Dexterity Bonus is a derived combat stat from permanent Dexterity
and Total SP; SP is a permanent stat; `DESTROY POTENTIAL` is a move tag; and
interference is combat-engine participation state.

## ND-017 - Disadvantage and floating effects

Status: Approved

Decision: DISADVANTAGE rolls two dice and uses the lower result. A floating
effect persists after its move resolves, is tracked beside the combat turn
counter, and ends through its own expiry conditions. An effect that ends a
floating effect selects one tracked floating effect.

## ND-018 - Drain and defense immunity

Status: Approved

Decision: `DRAIN N KI` makes the opponent lose N KI; the source gains no KI
unless the effect explicitly says so. `Cannot be STOPPED` and `cannot be
BLOCKED` prevent their ordinary resolution paths. Explicit exceptions prevail;
an attack that is not stopped cannot counter. NEGATE or SUPPRESS applied before
the attack removes the immunity effect.

## ND-019 - Skill slots and extra actions

Status: Approved

Decision: A character normally has four Skill Slots. A move that does not take
up a turn is an extra action in its normal phase. A move that does not take up
a Skill Slot can be equipped without consuming one. A rule allowing two Skills
per turn permits two Skills in the ACTION phase instead of one.

## ND-020 - Unrestricted moves

Status: Approved

Decision: A move is UNRESTRICTED when it does not have a `RESTRICTEDxN` use
limit. Its unrestricted state is determined by its base move definition.

## ND-021 - Restricted-use increases

Status: Approved

Decision: `RESTRICTED+N` increases a move's remaining per-combat use limit by
N. It only modifies a move that already has a `RESTRICTEDxN` limit; it does not
make an unrestricted move restricted.

## ND-022 - Reversal of Fortune counter exception

Status: Approved

Decision: `Reversal of Fortune` explicitly grants a COUNTER even though its
triggering attack is not STOPPED. This is an exception to the general rule that
an attack must be stopped before it can counter.

## ND-023 - Karmic Possession copied effect context

Status: Approved

Decision: When `Karmic Possession` applies the SUCCESSFUL effect from its
selected prior Advanced Attack, that effect resolves as though Karmic
Possession generated it. Its targets, timing, limits, and source-move
references therefore use Karmic Possession's resolution context.

## ND-024 - Bomb Tag delayed-damage timing

Status: Approved

Decision: Bomb Tag's delayed damage remains scheduled for the beginning of the
affected opponent's second turn. A SUCCESSFUL physical attack against someone
other than the Bomb Tag user does not cause that damage to resolve early.

## ND-025 - Forgetting a move in combat

Status: Approved

Decision: When a move effect says that its user may "forget" the move, that
move is removed only from the user's moveset for the current combat. It is not
removed from permanent learned-move data.

## ND-026 - Initial last defensive-roll result

Status: Approved

Decision: An effect that reads the user's last defensive-roll result uses `0`
when the user has not yet made a defensive roll in the current combat.

## ND-027 - Dashing Fist Drive single attack

Status: Approved

Decision: Dashing Fist Drive's "next single attack" means the user's next
single-die attack. A multi-die attack is not eligible for the base-roll change.

## ND-028 - Braced Energy Beam multi-die reroll

Status: Approved

Decision: If any result in the affected opponent's next multi-die attack is
20 or higher, Braced Energy Beam makes the opponent reroll the entire attack.
The effect still causes no more than one reroll per turn.

## ND-029 - Crescent Kick critical threshold

Status: Approved

Decision: Crescent Kick can critically hit when its final attack-roll result,
after modifiers, is 30 or higher.

## ND-030 - Karmic Possession multi-die damage

Status: Approved

Decision: When Karmic Possession selects a multi-die Advanced Attack, its
damage equals the total HP damage dealt by all of that attack's successful hits.

## ND-031 - One-Arm Shoulder Throw next-turn cost

Status: Approved

Decision: One-Arm Shoulder Throw's +1 KI cost applies to every physical attack
the affected opponent performs on their next turn.

## ND-032 - Combat-action history

Status: Approved

Decision: The last attack is the last completed attack action, not an
individual die. Counter-phase attacks count as attacks and turns. Blocks count
as stopped attacks. Forced actions count as the action actually taken.
Non-attack actions do not break an in-a-row attack sequence; a sequence resets
only when its own wording says it does. A counter attack contributes to a
sequence only when it satisfies that sequence's stated subject and conditions.

## ND-033 - Forced actions and declarations

Status: Approved

Decision: A forced action is revalidated when it would resolve. If its required
move or category is illegal, locked, suppressed, unavailable, or unaffordable,
the combatant passes. A Future Sight declaration names the move only; optional
costs and choices remain undeclared. When one owner's effects impose
incompatible required actions, that owner chooses. When a combatant's required
action conflicts with an opponent's required action, the combatant passes.

## ND-034 - Copied and rewritten effect clauses

Status: Approved

Decision: A copied move or SUCCESSFUL clause is an immutable snapshot of its
base clauses and does not track later modifications. It resolves as though the
copying move generated it: targets, timing, costs, use limits, selectors, and
source-move references use the copying move's resolution context. Removing all
SUCCESSFUL effects removes both printed clauses and clauses granted by other
effects. Mimicry Master's conversion of an opponent's effects to SUCCESSFUL
effects applies to all of that opponent's moves.

## ND-035 - Perfect rolls

Status: Approved

Decision: A perfect roll reaches or exceeds the highest side of the applicable
die after modifiers. A Dexterity-adjusted CRITICAL or COUNTER threshold counts
as perfect. For a multi-die roll, at least half of its dice must qualify as
perfect.

## ND-036 - Multi-combatant targeting and joint attacks

Status: Approved

Decision: Targets are declared together. The main combatant target resolves
effects first; the remaining targeted participants choose their resolution
order. In a synchronized attack, the main attacker rolls first, then additional
attackers; the defender makes one defense roll against all attackers, and
costs, damage, and effects resolve in that order. A remote participant joining
for one turn is an interferer.

## ND-037 - Racial and transformation abilities

Status: Approved

Decision: Racial Traits are abilities defined by the character's race.
Transformation effects include anything gained from a transformation.
`Special Traits` is normalized to `Transformation Abilities`; they are the same
concept. Suppressing or removing an ability includes floating effects, stat
gains, and effects not yet triggered, but does not undo effects already
resolved. A suppressed ability resumes with its prior duration and state.

## ND-038 - Negating combat results

Status: Approved

Decision: A negation of STUN, CRITICAL, or COUNTER occurs after that result is
triggered but before it resolves. The dice result remains unchanged and is
treated as though that result had not triggered.

## ND-039 - Return Fire dice reduction

Status: Approved

Decision: Return Fire's reduction to the affected opponent's "dice" applies
only to their attack and defense dice. It does not affect transformation dice.

## ND-040 - Close Shave multi-die equality

Status: Approved

Decision: Against a multi-die attack, Close Shave stops only the attack die
whose result exactly equals the defensive-roll result.

## ND-041 - Heavenly Execution multi-die stop threshold

Status: Approved

Decision: Against Heavenly Execution, a defensive roll stops each individual
attack die only when it is at least four higher than that die's attack result.

## ND-042 - Breathtaker multi-die roll modifier

Status: Approved

Decision: Breathtaker's -10 modifier applies to every attack-roll result of
the affected opponent's next multi-die attack.

## ND-043 - Slow Charge turn count

Status: Approved

Decision: Slow Charge counts only turns completed before the turn on which it
is performed. The current turn does not count toward its damage or result
bonuses.

## ND-044 - Tears of the Mystic multi-die modifier

Status: Approved

Decision: Tears of the Mystic's per-successful-hit modifier applies to every
attack-roll result of the affected next Aoyosumu Advanced Attack.

## ND-045 - Follow Up multi-die base damage

Status: Approved

Decision: When Follow Up follows a multi-die Advanced Attack, its damage is
50% of the base damage from one die of that prior attack.

## ND-046 - Impulsive moveset ordering

Status: Approved

Decision: Impulsive indexes Advanced Attacks by their top-to-bottom order on
the character sheet.

## ND-047 - Impulsive reindexing after removal

Status: Approved

Decision: When an Advanced Attack is removed from the moveset during combat,
Impulsive reindexes the remaining Advanced Attacks by their current top-to-bottom
character-sheet order.

## ND-047 - Match terminology

Status: Approved

Decision: `match` is synonymous with the current combat. Per-match and
per-combat limits share one counter. Effects lasting for the remainder of the
match end when their user leaves as an interferer, is body-swapped, defeated,
or flees.

## ND-048 - Generic SUCCESSFUL clauses on multi-die attacks

Status: Approved

Decision: A generic SUCCESSFUL clause on a multi-die attack resolves once when
at least one attack die succeeds. Explicit per-hit and numeric-threshold
clauses retain their stated behavior.

## ND-049 - Direct HP loss and damage

Status: Approved

Decision: An instruction to lose HP is direct resource loss, not damage. It
bypasses ordinary damage modifiers but remains subject to effects that
explicitly prevent HP loss. Direct HP loss still triggers effects that react
to dealing or taking damage. An instruction that a target takes Damage,
including delayed Damage, uses the normal damage pipeline.

## ND-050 - Total HP, Max HP, and HP-gain cap

Status: Approved

Decision: `Total HP` and `Max HP` refer to the same value. Normalize the term
to `Max HP`. Gaining HP cannot raise current HP above Max HP.

## ND-051 - Defeat interruption and zero HP

Status: Approved

Decision: An eligible effect that triggers when a combatant reaches 0 HP
interrupts defeat before it becomes final. HP does not become negative and is
held at 0 while the interrupt resolves. Immediate healing that raises HP above
0 prevents defeat. An effect that grants only a future heal, such as Spirited
Effort, does not independently keep a combatant alive.

## ND-052 - Rapture healing basis

Status: Approved

Decision: Rapture's `HEAL (25% Damage)` uses the final damage dealt by Rapture
after modifiers.

## ND-053 - STUN and BREAK multipliers

Status: Approved

Decision: `STUNxN` skips the next N eligible turns. Multiple STUN applications
add their remaining skipped-turn counts. `BREAKxN` applies N BREAK stacks in
one application, processing each stack against the four-BREAK cap.

## ND-054 - SEVER selection

Status: Approved

Decision: The attacker selects the limb type removed by SEVER. Arm and Leg do
not distinguish left from right, and an already severed limb type may be
selected again. Tail cannot be selected for a target without a valid tail;
another valid limb type must be selected.

## ND-055 - Advantage

Status: Approved

Decision: ADVANTAGE rolls two dice and uses the higher result. A multi-die roll
cannot gain ADVANTAGE.

## ND-056 - Negative Power Up KI modifiers

Status: Approved

Decision: An effect that makes a combatant gain negative KI from Power Up
reduces the KI produced by that Power Up event. It is not a separate KI-loss
event after gaining the normal amount.

## ND-057 - Dragon Blast temporary restriction

Status: Approved

Decision: Dragon Blast's selected move becomes restricted for all applicable
rules, selectors, blocking, and interference for the remainder of that combat.
It receives a one-use RESTRICTED counter for that duration. Uses made before
Dragon Blast selected the move do not exhaust the new counter.

## ND-058 - Cancellation Mastery source cost

Status: Approved

Decision: Cancellation Mastery's X is the cost of the move that caused the
STUN, CRITICAL, or COUNTER result, regardless of that move's category.

## ND-059 - Delayed Death Ball

Status: Approved

Decision: When Death Ball is withheld, it must be performed on the user's next
turn and cannot be held longer. Its KI cost and RESTRICTED use are consumed
when it is first used, before being withheld.

## ND-060 - BOOMerang fallback cost

Status: Approved

Decision: BOOMerang costs 3 KI on the user's next turn when the opponent did
not attack before that turn.

## ND-061 - Test of Strength ties

Status: Approved

Decision: When Test of Strength produces a tie, its user wins the contest and
the opponent loses HP.

## ND-062 - Unqualified move selectors

Status: Approved

Decision: Torpedo Kick's `Choose a Block`, Chokeslam's `Choose an energy
attack`, and Somersault Roll's `Choose up to 2 Skills` may select eligible
moves possessed by either participant.

## ND-063 - Follow Up inherited traits

Status: Approved

Decision: Follow Up inherits the tags of the Akaikaru attack selected for its
effect. `ALL TRAITS` does not give Follow Up every attack tag simultaneously.

## ND-064 - Big Bang Crash attack type

Status: Approved

Decision: Big Bang Crash is an energy attack. Its Physical-attack wording is
not authoritative.

## ND-065 - Sonic Boom damage basis

Status: Approved

Decision: Sonic Boom deals damage based on 55% of Power.

## ND-066 - Thunder Ball modifier terminology

Status: Approved

Decision: Dice-result modifiers are not damage modifiers for Thunder Ball's
effect. Thunder Ball's X is capped at +6, while its final attack-roll
result-modifier total may reach +8.

## ND-067 - HEAL terminology

Status: Approved

Decision: HEAL means gaining HP. It triggers effects that react to gaining HP
and is prevented by an effect that says the combatant cannot gain HP. HEAL
must be defined in the rules glossary.

## ND-068 - Leg Vice active CONSTANT scope

Status: Approved

Decision: Leg Vice's active CONSTANT Skill condition includes an eligible
active CONSTANT Skill controlled by either combatant.

## ND-069 - Time Freeze energy-attack restriction

Status: Approved

Decision: The Time Freeze user cannot perform energy attacks during the same
next two turns in which Time Freeze STUNS allies and opponents.

## NR-001 - Empty item description

Status: Resolved
Source: `reference/items/equipment.md:198`
Resolution: The source description was supplied.

## NR-002 - Empty inventory-slot value

Status: Resolved
Source: `reference/items/equipment.md:638`
Resolution: The source inventory-slot value was supplied.

## NR-003 - Incomplete Senzu Bean effect

Status: Resolved
Source: `reference/items/equipment.md:22`
Resolution: The source effect was corrected.

## NR-004 - Moves without tags

Status: Resolved
Sources:

- `reference/moves/afterlife.md:77`
- `reference/moves/afterlife.md:355`
- `reference/moves/afterlife.md:426`
- `reference/moves/afterlife.md:431`
- `reference/moves/afterlife.md:436`
- `reference/moves/afterlife.md:441`
- `reference/moves/afterlife.md:446`
- `reference/moves/afterlife.md:451`
- `reference/moves/haokiru.md:520`

Resolution: Afterlife moves use `[FREESTYLE, SKILL]`; `Playtime's Over` uses
`[HAOKIRU, BLOCK]`.

## NR-005 - Invalid Final Flash training days

Status: Resolved
Source: `reference/moves/afterlife.md:246`
Resolution: `Final Flash` has `Training Days: 4`; the following Hell section
label is preserved separately.

## NR-006 - Repeated Afterlife move names

Status: Resolved
Source: `reference/moves/afterlife.md`
Issue: Ten move names occur more than once in the same source scope:
`Give Me Energy!`, `Spirit Bomb`, `Special Beam Cannon`, `Instant
Transmission`, `Kamehameha`, `Warp Kamehameha`, `Super Kamehameha`, `Masenko`,
`Solar Flare`, and `Tri-Beam`.
Resolution: The first entry is authoritative. Later entries remain in the
Markdown guide as Heaven or Hell teaching references but do not create a second
structured move definition.
