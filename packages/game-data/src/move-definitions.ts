import { AFTERLIFE_MOVES } from "./moves/afterlife.js";
import { AKAIKARU_MOVES } from "./moves/akaikaru.js";
import { AOYOSUMU_MOVES } from "./moves/aoyosumu.js";
import { FREESTYLE_MOVES } from "./moves/freestyle.js";
import { HAOKIRU_MOVES } from "./moves/haokiru.js";
import { KIIHAKAI_MOVES } from "./moves/kiihakai.js";
import { KUROKONWAKU_MOVES } from "./moves/kurokonwaku.js";
import { MIDORIKATAI_MOVES } from "./moves/midorikatai.js";
import type { MoveDefinition } from "./shared/types.js";

export const MOVE_DEFINITIONS: readonly MoveDefinition[] = [
  ...AFTERLIFE_MOVES,
  ...AKAIKARU_MOVES,
  ...AOYOSUMU_MOVES,
  ...FREESTYLE_MOVES,
  ...HAOKIRU_MOVES,
  ...KIIHAKAI_MOVES,
  ...KUROKONWAKU_MOVES,
  ...MIDORIKATAI_MOVES,
];
