# SIM-080 mechanics-view audit

This audit is the repository-backed classification for the immutable combat
mechanics boundary. It is scoped to the local 1v1 combat and AI surface;
narrative, economy, travel, spaceship, and permanent-progression catalogs remain
outside the fight interpreter.

| Source family | Classification | Boundary |
| --- | --- | --- |
| Combat rules, moveset slots, and transformation combat configuration | authoritative mechanics | `CombatMechanicsView.rules` |
| Move attacks, typed move effects, restricted-use limits, and requirements | authoritative mechanics | `CombatMechanicsView.moves` |
| Combat-usable item definitions and typed item effects | authoritative mechanics | `CombatMechanicsView.items` |
| Transformation stat modifiers and combat abilities | authoritative mechanics | `CombatMechanicsView.transformations` |
| Selected races, racial traits, race classes, and generic classes | authoritative mechanics | `CombatMechanicsView.races` and `.genericClasses` |
| Lookup maps, race/class indexes, and compiled effect plans | view-local compilation | private immutable view indexes |
| Names, descriptions, source paths, clause provenance, and AI hints | safe canonical metadata/advisory input | copied with the view; text is not interpreted as rules |
| Locations, quests, saga prose, inventory-only rules, travel, economy, and spaceship records | execution-unrelated catalog access | remains outside combat |

The canonical assembly in `packages/combat-engine/src/mechanics-view.ts` is the
only combat module that composes module-level game-data and game-config
catalogs. `createCombatMechanicsView` validates duplicate IDs and unresolved
race/transformation references, deep-copies and freeze-protects definitions,
builds indexes and compiled-plan maps, and derives a deterministic SHA-256
identity from sorted mechanically relevant content.

The full view is not serialized into a fight snapshot. A snapshot retains only
`mechanicsView.identity`; a caller resuming an alternate fight must bind the
matching full view to `createCombatRuntime`. Canonical compatibility functions
reject alternate identities rather than evaluating them with canonical data.

Remaining legacy helper reads are tracked before SIM-090; typed variant
authoring and comparison workflows remain out of scope for SIM-080.
