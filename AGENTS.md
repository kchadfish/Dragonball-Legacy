# Agent Instructions

## Required Quality Gate

- **Incremental Verification:** After every meaningful code or configuration change, run the smallest relevant checks early.
- **Final Check:** Before finishing your response, run `npm run check` from the repository root. Do not report work as complete if `npm run check` fails. If it cannot run, state the exact reason and the remaining manual action.
- **Scope:** `npm run check` validates formatting, ESLint, Vitest, and the TypeScript solution build.
- **Coverage Trigger:** Run `npm run test:coverage` when changing combat calculations, game rules, validation schemas, transformation logic, persistence behavior, Discord moderation or command logic, or API behavior.

## Extended Quality Gate

- Run `npm run quality` before completing changes that substantially affect multiple packages, change package or architecture boundaries, add or upgrade dependencies, modify CI or deployment behavior, or prepare a release.
- `npm run quality` adds targeted coverage thresholds, duplication detection, and a production dependency audit to the routine `npm run check` gate.
- Do not weaken quality rules merely to make a change pass. Narrow, documented exclusions are permitted only for generated output, fixtures, static declarative game data, or intentional patterns.

## Test Standards

- Add or update focused Vitest tests for every major behavior change and bug fix.
- Cover normal behavior, relevant boundary conditions, and regression cases.
- Keep tests near the owning package in `src` or `tests`.
- Test public behavior rather than implementation details.
- Restore mocks and spies after tests that create them, using `vi.restoreAllMocks()` or an equivalent cleanup strategy, to prevent cross-test pollution.
- Do not add superficial tests merely to satisfy a count.

## Modern TypeScript & Node.js

- Use modern TypeScript and Node.js syntax consistent with the repository's configured versions.
- Prefer current language features and patterns, including standard platform APIs, ES modules, async/await, type-only imports, `satisfies`, discriminated unions, and explicit public package exports.
- Do not introduce deprecated APIs, legacy module patterns, obsolete syntax, or CommonJS constructs such as `require`, `module.exports`, or `__dirname` unless explicitly required by an existing integration.
- Confirm API support for installed dependency versions before using unfamiliar library methods.
- Address deprecation warnings by migrating to supported replacements rather than suppressing them.
- Do not upgrade dependencies, change compiler targets, or refactor established conventions solely to use newer syntax without explicit user approval.

## Boundaries & Monorepo Conventions

- **Architecture First:** Read `ARCHITECTURE.md` before adding dependencies or new game-domain concepts.
- **Input Validation:** Use stable lowercase, hyphenated IDs and Zod validation for untrusted input.
- **Workspace Imports:** Import across packages only through `@dragonball-resurgence/*` public exports. Never reach directly into another workspace's `src` directory.
- **Dependency Direction:** Applications may depend on packages, but never on other applications.
- **Environment & Git:** Use `npm` only. Keep generated build output, secrets, and local environment files out of version control. Preserve unrelated user changes.
