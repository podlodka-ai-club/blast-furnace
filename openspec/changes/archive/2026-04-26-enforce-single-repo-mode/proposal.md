## Why

Blast Furnace currently has an ambiguous repository selection model: Intake can poll repositories from the Redis `github:repos` registry and pass that identity through queue payloads, while downstream GitHub and git operations are historically configured around `GITHUB_OWNER` and `GITHUB_REPO`. For the next target state the orchestrator must run against exactly one environment-configured repository so an issue cannot be discovered in one repository and then processed, branched, cloned, labeled, or opened as a pull request in another.

## What Changes

- **BREAKING**: Remove multi-repository polling from the production intake path.
- **BREAKING**: Remove the repository registry API/UI from the supported runtime contract, or disable it so it cannot affect production intake.
- Poll only the configured repository from `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN`.
- Treat queue `repository` payload data as derived run context for the configured repository, not as an independent routing selector.
- Validate downstream stage payloads that still carry repository identity so stale or mismatched jobs fail before GitHub or git side effects.
- Ensure branch preparation, workspace clone, pull request creation, and issue label transitions operate only on the configured repository.
- Update tests, OpenSpec requirements, and documentation to describe single-repository operation.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `issue-intake`: Replace registry-driven repository polling with configured-repository-only polling and configured repository handoff.
- `github-issue-automation`: Replace the product-level repository selection contract with single-repository automation and remove operator-managed polling repositories from the supported workflow.
- `github-integration`: Remove repository override behavior from GitHub helper requirements and require issue fetching, branch refs, pull requests, and label transitions to target the configured repository.
- `prepare-run-job`: Require Prepare Run to operate on and hand off only the configured repository identity, failing mismatched payloads before side effects.
- `make-pr-job`: Require pull request finalization to validate the configured repository identity before commit, push, PR creation, or tracker handoff.
- `sync-tracker-state-job`: Require post-PR tracker synchronization and label transitions to validate and operate on the configured repository only.
- `repository-management`: Remove the Redis-backed repository registry API/UI from the active product contract.

## Impact

- Affected runtime code: `src/jobs/intake.ts`, stage payload construction/validation, `src/jobs/prepare-run.ts`, `src/jobs/make-pr.ts`, `src/jobs/sync-tracker-state.ts`, GitHub helper modules, repository route registration, and repository management route/UI modules if removed.
- Affected tests: intake tests for registered repository behavior, repository route/UI tests, GitHub helper tests for owner/repo overrides, and downstream stage tests for mismatched repository payloads.
- Affected documentation/specs: OpenSpec specs for intake, product automation, GitHub integration, repository management, and downstream stage repository contracts; README or operational docs that describe `/repos`, `/repos/manage`, or multi-repo polling.
- Runtime/data impact: existing Redis `github:repos` entries become ignored by production intake. No data migration is required unless operators want to clean stale Redis state.
