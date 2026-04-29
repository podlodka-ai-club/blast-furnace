# make-pr-job Specification

## Purpose
TBD - created by archiving change add-pipeline-step-jobs. Update Purpose after archive.
## Requirements
### Requirement: Make PR Job Module
The system SHALL provide a `make-pr` job handled by an isolated Make PR module that reads stable run context from the run summary, reads reviewed input and required development context from explicit JSONL dependencies, owns deterministic configured-repository finalization, appends formal terminal or pull-request output, and hands post-PR tracker processing to Sync Tracker State only when a pull request exists.

#### Scenario: Make PR job receives reviewed data
- **WHEN** a `make-pr` job runs with a handoff record reference from `review`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** the Make PR module SHALL read issue data, configured repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** the Make PR module SHALL read review output from the referenced Review handoff record
- **AND** the Make PR module SHALL read development and quality output from explicit dependency record ids required for finalization
- **AND** use the workspace path read from stable run context to finalize the issue branch

#### Scenario: Repository identity is mismatched
- **WHEN** Make PR reads repository identity that does not match the configured repository
- **THEN** Make PR SHALL fail before checking workspace changes, committing, pushing, creating a pull request, cleaning up a no-change workspace, appending a successful handoff record, or enqueueing Sync Tracker State

#### Scenario: No changes are produced
- **WHEN** Make PR determines that development produced no repository changes
- **THEN** it SHALL skip commit, push, pull request creation, and tracker synchronization
- **AND** treat that no-change outcome as terminal within `make-pr`
- **AND** append a terminal no-change output record to the JSONL ledger
- **AND** the output SHALL NOT include review, development, quality, plan, assessment, or stable run context data
- **AND** attempt to clean up the workspace path read from stable run context
- **AND** SHALL NOT enqueue `sync-tracker-state`

#### Scenario: Changes are produced
- **WHEN** Make PR determines that development produced repository changes
- **THEN** it SHALL commit those changes to the issue branch
- **AND** sanitize the issue title by removing newlines and limiting it to 200 characters
- **AND** use commit message `Processed issue #{number} via codex: {sanitizedTitle}`
- **AND** exclude `.orchestrator/**` from target repository status checks and staging
- **AND** SHALL NOT include orchestration run artifacts in the target repository commit or pull request

#### Scenario: Changes are pushed
- **WHEN** Make PR creates a commit
- **THEN** it SHALL push the issue branch to the configured repository's authenticated remote
- **AND** retry push up to 3 attempts with exponential backoff

#### Scenario: Pull request is created
- **WHEN** Make PR pushes changes successfully
- **THEN** it SHALL create a pull request in the configured repository
- **AND** use title `Process issue #{number}: {sanitizedTitle}`
- **AND** use the issue branch as head
- **AND** use `main` as base
- **AND** use body `Closes #{number}`
- **AND** append a formal pull request output record to the JSONL ledger
- **AND** the output SHALL include pull request result data only
- **AND** the output SHALL NOT include review, development, quality, plan, assessment, or stable run context data
- **AND** enqueue `sync-tracker-state` with `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference

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

