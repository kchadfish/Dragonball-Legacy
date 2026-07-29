# Semantic Conversion Blockers

This ledger records unresolved source mechanics found during declarative
conversion. Each entry includes the full source effect and the exact ruling
needed. Once resolved, record the decision in `normalization-decisions.md`.

## SB-001 - Impulsive moveset changes

Status: Resolved — see ND-047 in `normalization-decisions.md`.

Source: `reference/moves/akaikaru.md` — Impulsive

Effect: Constant. Activate during your UPKEEP phase. Roll 1dX (X = number of
Advanced Attacks in your move set) every turn. The number you roll corresponds
to the number that an Advanced Attack appears in your move set. You must
perform that attack, or pass if you cannot pay the cost. That attack does +(10%
Power) damage and costs -1 KI to perform to a minimum of 1. You may DEACTIVATE
this Skill at the start of any turn. This Skill costs +2 KI to activate for
every time it's been activated during combat. Cost: 2 KI.

Resolution: Reindex the remaining Advanced Attacks by their current top-to-bottom
character-sheet order.

## SB-002 - Test of Strength tied contest

Status: Needs ruling.

Source: `reference/moves/midorikatai.md` — Test of Strength

Effect: Physical attack. Deal (0% Power) damage. You and your opponent roll
1d10 three times each. The person who rolls 5 or higher the most times loses
(55% Your Power) HP. If you have higher power than your opponent, you count
how many roll are 6 or higher instead. Cost: 1 KI.

Ruling needed: If both participants have the same count of qualifying rolls,
does neither participant lose HP, do both lose HP, or is a tiebreaker roll
required?

## SB-003 - Leg Vice active-constant scope

Status: Needs ruling.

Source: `reference/moves/midorikatai.md` — Leg Vice

Effect: RESTRICTEDx1. Block. Stop a physical attack. Your opponent loses their
Dexterity Bonus for their next 2 turns. If any CONSTANT Skills are active, your
next attack cannot be BLOCKED. Cost: X-1 KI.

Ruling needed: Does “any CONSTANT Skills are active” include active CONSTANT
Skills controlled by either combatant, only the user, or only the opponent?
