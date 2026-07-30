import type { LocationId, MoveId, TransformationId } from "./ids.js";

export type Requirement =
  | { readonly type: "minimum-power-level"; readonly value: number }
  | { readonly type: "minimum-strength-level"; readonly value: number }
  | { readonly type: "learned-move"; readonly moveId: MoveId }
  | {
      readonly type: "transformation-unlocked";
      readonly transformationId: TransformationId;
    }
  | {
      readonly type: "thread-in-location";
      readonly locationIds: readonly LocationId[];
    }
  | { readonly type: "narrative-trigger"; readonly triggerId: string }
  | { readonly type: "moveset-excludes"; readonly moveIds: readonly MoveId[] }
  | { readonly type: "source-text"; readonly text: string };
