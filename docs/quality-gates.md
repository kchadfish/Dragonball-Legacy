# Quality gates

`npm run check` is the routine development gate. It verifies formatting, ESLint,
reference and game-data validation, combat-engine boundary validation, Vitest,
and the TypeScript solution build.

The solution build deliberately uses `tsc -b` rather than `tsc --noEmit`.
Project references, declaration generation, and each workspace's `dist/` output
are part of the monorepo contract and must be validated together.

`npm run quality` runs `check` and then adds three release-oriented checks:

- targeted V8 coverage for `packages/combat-engine` and
  `packages/game-data/src/validation.ts`, with 80% lines, statements, and
  functions coverage and 75% branch coverage;
- jscpd duplication detection across `apps/` and `packages/`, with an 8%
  threshold; and
- `npm audit --omit=dev --audit-level=high`, which blocks high-severity
  production dependency vulnerabilities.

Coverage intentionally excludes package re-exports, test helpers, application
bootstraps, generated game-data definitions, and static catalogs. Generated and
declarative game data are instead checked by `npm run validate:game-data`.

Duplication detection excludes tests, fixtures, build and coverage output,
generated definitions, and static move/style catalogs. Those paths are
intentionally declarative or repetitive; all other application and package
source remains in scope.

SonarJS complexity limits apply to production TypeScript. Generated catalogs,
test support, and conversion or repository-validation scripts are excluded from
that rule because they are data conversion or verification tooling, not runtime
application behavior. The game-data validator also performs intentionally
exhaustive independent checks; its coverage threshold and dedicated tests guard
that behavior while it remains structured as a rule table.

The combat engine's invariant checker and state-transition reducer retain
documented complexity exceptions. They are deterministic state machines covered
by focused transition tests; split them only when a distinct domain operation
emerges, rather than extracting helpers that obscure state ownership.

Handle security findings by removing exposed secrets immediately, rotating any
credential that was committed, and investigating production audit findings
before release. Development-only audit findings do not block this quality gate.
Gitleaks scans repository history separately in GitHub Actions.
