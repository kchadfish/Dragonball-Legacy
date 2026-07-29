# Game Data Authoring Standard

The Markdown files in this directory are the human-readable reference for game
rules. They retain descriptive prose and BBCode. TypeScript definitions are
reviewed against these files and are the structured input consumed by game
systems.

## General Rules

- Use one file per domain or style.
- Use field-based Markdown with canonical field names.
- Use lowercase-hyphenated IDs in TypeScript. Markdown uses display names.
- Use uppercase tokens for defined combat terms, such as `BREAK`, `LOCK`, and
  `RESTRICTED`.
- Use `Requirements: None` when an entry has no requirements.
- Do not leave required fields blank. Record unresolved content in
  `normalization-decisions.md` and do not generate the affected TypeScript
  entity.
- Preserve BBCode and prose in Markdown. Generated TypeScript must contain
  structured mechanics and plain description text, not BBCode.

## Canonical Terminology

- The serenity style is `Aoyosumu`.
- The energy style is `Kiihakai`.
- Alternate spellings must be corrected in Markdown rather than treated as
  aliases.
- The KI resource is written as `KI` in rule prose.

## Canonical Fields

Move entries use this form and field order:

```md
## Move Name [STYLE, CATEGORY, TAG]
Description: <human-readable prose>
Effect: <human-readable rule prose>
Requirements: None | <requirements>
Training Days: <positive integer>
Location: <location list>
```

Optional fields are only present when applicable. Their canonical names are
`Timing`, `Notes`, `Cost`, `Attack Roll`, `Reward`, `Battle Info`, and
`Location`.

BBCode may group or decorate entries, but it must not be used as the move-entry
marker. Every move begins with a Markdown `##` heading.

## Combat Taxonomy

Every structured mechanic must be classified before it can enter TypeScript.
The classification is based on behavior, not its uppercase prose token.

### Combat Result

A combat result is an immutable outcome produced while resolving an action or
roll. It does not persist independently after the resolution unless an effect
uses it to create a state change.

Examples of result categories include attack success or failure, critical
outcomes, defensive outcomes, and counter outcomes. A result may trigger an
effect, but is not itself an effect.

### Status

A status is named state attached to a combatant, move, or combat session. It
persists across one or more resolution steps and has explicit duration,
stacking, removal, and immunity behavior.

A mechanic is a status only when its rules require the engine to remember it
after the action that created it resolves.

### Effect Operation

An effect operation is a declarative instruction that runs at a trigger and
changes resolution or state. It has a trigger, target, conditions, and
parameters. It may apply or remove a status, modify a roll or resource, lock a
move, or produce another structured state change.

An effect operation does not become a status merely because it has a duration;
it creates a status when the affected state must be independently tracked.

### Classification Rule

For each mechanic, answer these questions in order:

1. Is it an outcome of resolving one roll or action, with no independent
   ongoing state? Classify it as a combat result.
2. Does it persist as named, independently removable or stackable state?
   Classify it as a status.
3. Does it instruct the engine to modify an action, resource, result, or
   state? Classify it as an effect operation.
4. If more than one answer applies, model the result first, then the operation
   that creates or reacts to the status.

Terms such as `BREAK`, `SEVER`, `LOCK`, `STUN`, `COUNTER`, `CRITICAL`,
`SUPPRESS`, `NEGATE`, `DEACTIVATE`, and `COOLDOWN` must be classified under
this rule before their TypeScript definitions are authored.

## TypeScript Review Gate

Every TypeScript entity must identify its Markdown source path and be reviewed
against its prose. A source ambiguity, blank required field, unsupported
mechanic, or source/TypeScript mismatch is recorded as `Needs ruling` and
blocks generation of that entity.
