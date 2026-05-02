## ADDED Requirements

### Requirement: Make PR Human Rework Finalization
The Make PR module SHALL finalize successful human rework by updating the existing pull request branch and handing off to Sync Tracker State instead of creating a new pull request.

#### Scenario: Make PR receives rework-reviewed data
- **WHEN** a `make-pr` job receives a successful Review handoff for a human rework run
- **THEN** Make PR SHALL resolve the PR Rework Intake handoff from the dependency chain
- **AND** Make PR SHALL read pull request identity, expected head repository, expected head branch, and expected head SHA from the resolved rework context
- **AND** Make PR SHALL use the workspace path read from the run summary to finalize the existing pull request branch

#### Scenario: Existing pull request head is validated
- **WHEN** Make PR finalizes human rework
- **THEN** it SHALL fetch the current pull request state before committing or pushing
- **AND** the pull request head repository SHALL match the configured repository
- **AND** the pull request head branch SHALL match the expected branch from the rework context
- **AND** the pull request head SHA SHALL match the expected head SHA captured by PR Rework Intake or Prepare Run
- **AND** Make PR SHALL reject fork pull requests, unexpected repositories, unexpected branches, and unexpected head SHAs before commit or push side effects

#### Scenario: Rework changes are pushed
- **WHEN** Make PR determines that human rework produced repository changes and PR head validation passes
- **THEN** it SHALL commit those changes to the existing pull request branch
- **AND** push the existing pull request branch to the configured repository authenticated remote
- **AND** append a pull request finalization handoff record
- **AND** enqueue `sync-tracker-state` with the handoff record reference
- **AND** SHALL NOT create a new pull request

#### Scenario: Rework produces no changes
- **WHEN** Make PR determines that human rework produced no repository changes
- **THEN** it SHALL append a pull request finalization handoff record for the existing pull request
- **AND** enqueue `sync-tracker-state` with the handoff record reference
- **AND** SHALL NOT treat the no-change rework as terminal within Make PR
- **AND** SHALL NOT clean up the workspace itself

#### Scenario: Rework push has non-fast-forward conflict
- **WHEN** pushing the existing pull request branch fails because the remote branch is not a fast-forward update
- **THEN** Make PR SHALL refetch the pull request branch
- **AND** verify the pull request head repository and branch again
- **AND** retry branch update using the configured bounded push retry policy
- **AND** fail without removing the `Rework` label or moving tracker state when the branch cannot be updated safely after retries are exhausted
