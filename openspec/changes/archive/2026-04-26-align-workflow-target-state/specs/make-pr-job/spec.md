## MODIFIED Requirements

### Requirement: Make PR Job Module
The system SHALL provide a `make-pr` job handled by an isolated Make PR module that owns deterministic repository finalization and hands post-PR tracker processing to Sync Tracker State only when a pull request exists.

#### Scenario: Make PR job receives reviewed data
- **WHEN** a `make-pr` job runs with data from `review`
- **THEN** the Make PR module SHALL preserve the received run, issue, repository, branch, workspace, development, quality, review, and attempt data as needed
- **AND** use the received workspace path to finalize the issue branch

#### Scenario: No changes are produced
- **WHEN** Make PR determines that development produced no repository changes
- **THEN** it SHALL skip commit, push, pull request creation, and tracker synchronization
- **AND** treat that no-change outcome as terminal within `make-pr`
- **AND** attempt to clean up the received workspace path
- **AND** SHALL NOT enqueue `sync-tracker-state`

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
- **AND** enqueue `sync-tracker-state` with the received run, issue, repository, branch, workspace path, attempt data, and created pull request result

#### Scenario: Tracker transition is deferred
- **WHEN** pull request creation succeeds
- **THEN** Make PR SHALL NOT move issue labels or tracker state itself
- **AND** SHALL leave post-PR tracker synchronization to Sync Tracker State

#### Scenario: Git or pull request operation fails
- **WHEN** commit, push, or pull request creation fails
- **THEN** Make PR SHALL fail the job

#### Scenario: Make PR module remains isolated
- **WHEN** Make PR behavior is implemented
- **THEN** Make PR-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `make-pr` jobs
