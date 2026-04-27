## MODIFIED Requirements
### Requirement: Make PR Job Module
The system SHALL provide a `make-pr` job handled by an isolated Make PR module that owns deterministic repository finalization and hands post-PR terminal processing to Check PR only when a pull request exists.

#### Scenario: Make PR job receives reviewed data
- **WHEN** a `make-pr` job runs with data from `review`
- **THEN** the Make PR module SHALL preserve the received issue and branch data as is
- **AND** use the received temporary repository path to finalize the issue branch

#### Scenario: No changes are produced
- **WHEN** Make PR determines that development produced no repository changes
- **THEN** it SHALL skip commit, push, pull request creation, and label transition
- **AND** treat that no-change outcome as terminal within `make-pr`
- **AND** attempt to clean up the received temporary repository path
- **AND** SHALL NOT enqueue `check-pr`

#### Scenario: Changes are produced
- **WHEN** Make PR determines that development produced repository changes
- **THEN** it SHALL commit those changes to the issue branch
- **AND** sanitize the issue title by removing newlines and limiting it to 200 characters
- **AND** use commit message `Processed issue #{number} via codex: {sanitizedTitle}`

#### Scenario: Changes are pushed
- **WHEN** Make PR creates a commit
- **THEN** it SHALL push the issue branch to the authenticated remote
- **AND** retry push up to 3 attempts with exponential backoff

#### Scenario: Pull request is created
- **WHEN** Make PR pushes changes successfully
- **THEN** it SHALL create a pull request
- **AND** use title `Process issue #{number}: {sanitizedTitle}`
- **AND** use the issue branch as head
- **AND** use `main` as base
- **AND** use body `Closes #{number}`
- **AND** enqueue `check-pr` with the received issue, branch, temporary repository path, and created pull request result

#### Scenario: Label transition after pull request
- **WHEN** pull request creation succeeds
- **THEN** Make PR SHALL attempt to move the issue labels from `ready` to `in review`
- **AND** log a warning instead of failing the job when label transition fails

#### Scenario: Git or pull request operation fails
- **WHEN** commit, push, or pull request creation fails
- **THEN** Make PR SHALL fail the job

#### Scenario: Make PR module remains isolated
- **WHEN** Make PR behavior is implemented
- **THEN** Make PR-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `make-pr` jobs
