# sync-tracker-state-job Specification

## Purpose
Defines the target Sync Tracker State stage that owns post-PR tracker synchronization and terminal workspace cleanup.
## Requirements
### Requirement: Sync Tracker State Job Module
The system SHALL provide a `sync-tracker-state` job handled by an isolated Sync Tracker State module that reads stable run context from the run summary, reads pull request input from the JSONL ledger, owns post-pull-request tracker synchronization in the configured repository, appends formal tracker-sync output, performs workspace cleanup for pull-request-created and rework-finalized paths, and hands post-PR lifecycle monitoring to PR Rework Intake.

#### Scenario: Sync Tracker State receives pull request data
- **WHEN** a `sync-tracker-state` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `sync-tracker-state`
- **AND** Sync Tracker State SHALL read issue data, configured repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** Sync Tracker State SHALL read pull request result data from the referenced Make PR handoff record

#### Scenario: Repository identity is mismatched
- **WHEN** Sync Tracker State reads repository identity that does not match the configured repository
- **THEN** Sync Tracker State SHALL fail before attempting tracker side effects
- **AND** SHALL still attempt workspace cleanup when a workspace path is available from stable run context

#### Scenario: Tracker state is synchronized
- **WHEN** Sync Tracker State receives pull request data
- **THEN** it SHALL attempt the configured tracker-side effects for the source issue in the configured repository
- **AND** those side effects SHALL include moving the issue from `ready` to `in review` when GitHub label tracking is configured

#### Scenario: Rework tracker state is synchronized
- **WHEN** Sync Tracker State receives pull request finalization data for a human rework run
- **THEN** it SHALL remove the `Rework` label from the pull request
- **AND** it SHALL move the source issue to `in review` when GitHub label tracking is configured
- **AND** it SHALL perform those side effects even when the rework Make PR handoff indicates no repository changes were produced

#### Scenario: Tracker synchronization fails
- **WHEN** the pull request was created or finalized but tracker synchronization fails
- **THEN** Sync Tracker State SHALL keep the pull request result available to the run in the JSONL ledger
- **AND** log the tracker synchronization failure
- **AND** SHALL NOT fabricate a failed pull request creation or rework finalization result

#### Scenario: Workspace cleanup runs
- **WHEN** Sync Tracker State completes or fails after reading a workspace path
- **THEN** it SHALL attempt to clean up that workspace path
- **AND** refuse to delete paths outside `/tmp`
- **AND** refuse to delete symbolic links
- **AND** SHALL NOT delete the run summary or handoff ledger under the Blast Furnace repository's `.orchestrator/runs/...` storage

#### Scenario: Sync Tracker State output is recorded
- **WHEN** Sync Tracker State finishes tracker synchronization and cleanup work
- **THEN** it SHALL append a tracker-sync output record to the JSONL ledger
- **AND** the output SHALL include tracker synchronization data only
- **AND** the output SHALL NOT include pull request, review, development, quality, plan, assessment, PR Rework Intake, or stable run context data
- **AND** update the run summary without marking the run complete when PR Rework Intake will be scheduled

#### Scenario: PR Rework Intake is scheduled after tracker sync
- **WHEN** Sync Tracker State appends tracker-sync output after pull request creation or rework finalization
- **THEN** it SHALL enqueue `pr-rework-intake` with `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and the Sync Tracker State handoff record reference
- **AND** it SHALL NOT monitor pull request merge state
- **AND** it SHALL NOT collect review comments
- **AND** it SHALL NOT run route analysis

#### Scenario: Sync Tracker State module remains isolated
- **WHEN** Sync Tracker State behavior is implemented
- **THEN** Sync Tracker State-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `sync-tracker-state` jobs

