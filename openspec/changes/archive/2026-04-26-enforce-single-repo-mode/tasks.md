## 1. Regression Tests

- [x] 1.1 Update intake tests to prove Redis `github:repos` entries are ignored, only the configured repository is fetched, and `prepare-run` payloads carry the configured repository identity.
- [x] 1.2 Update GitHub issue fetching tests to prove owner/repo override data is not used and GitHub requests always target `config.github.owner` and `config.github.repo`.
- [x] 1.3 Add Prepare Run tests proving mismatched payload repository identity fails before branch lookup, branch creation, workspace creation, clone, artifact write, or Assess enqueue.
- [x] 1.4 Add Make PR tests proving mismatched payload repository identity fails before workspace status checks, commit, push, pull request creation, no-change cleanup, or Sync Tracker State enqueue.
- [x] 1.5 Add Sync Tracker State tests proving mismatched payload repository identity fails before tracker side effects and still attempts terminal workspace cleanup.
- [x] 1.6 Update server tests to prove `GET /repos`, `POST /repos`, `DELETE /repos/:owner/:repo`, and `GET /repos/manage` are no longer registered runtime routes.
- [x] 1.7 Run the focused tests changed above and confirm the new expectations fail for the expected single-repo behavior before implementation changes.

## 2. Single Repository Selection

- [x] 2.1 Add or centralize a configured repository identity helper based on `config.github.owner` and `config.github.repo`.
- [x] 2.2 Update `src/jobs/intake.ts` to stop reading `github:repos`, stop exporting registry state as production behavior, and poll only the configured repository.
- [x] 2.3 Update Intake payload construction so every `prepare-run` job receives the configured repository identity.
- [x] 2.4 Update `src/github/issues.ts` so `fetchIssues()` no longer exposes or honors owner/repo routing overrides.
- [x] 2.5 Update issue fetching call sites, types, mocks, and fixtures to compile against configured-repository-only fetching.

## 3. Downstream Repository Validation

- [x] 3.1 Add a reusable assertion that rejects repository identities that do not match the configured repository.
- [x] 3.2 Apply repository identity validation at the start of Prepare Run before any GitHub, git, workspace, artifact, or queue side effect.
- [x] 3.3 Apply repository identity validation at the start of Make PR before workspace inspection, git operations, pull request creation, no-change cleanup, or tracker handoff.
- [x] 3.4 Apply repository identity validation in Sync Tracker State before tracker side effects while preserving `finally` cleanup behavior for received workspaces.
- [x] 3.5 Update downstream stage fixtures and type tests so repository identity is consistently the configured repository unless a test intentionally covers mismatch failure.

## 4. Repository Registry Surface Removal

- [x] 4.1 Remove repository route registration from `src/server/index.ts` so the runtime server no longer exposes `/repos` or `/repos/manage`.
- [x] 4.2 Delete or retire repository registry API/UI modules and tests that only support the removed runtime contract.
- [x] 4.3 Remove stale imports, constants, exported symbols, and type usages tied only to repository registry management.
- [x] 4.4 Update README and operational docs to remove repository registry API/UI and multi-repo polling guidance.

## 5. Verification

- [x] 5.1 Run focused tests for intake, GitHub issue fetching, Prepare Run, Make PR, Sync Tracker State, server routes, and type contracts.
- [x] 5.2 Run `npm test`.
- [x] 5.3 Run `npm run lint`.
- [x] 5.4 Run `npm run build`.
- [x] 5.5 Run OpenSpec validation/status for `enforce-single-repo-mode` and confirm the change is ready for implementation/archive flow.
