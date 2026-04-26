# sync-tracker-state-job Specification

## Purpose
Defines the target Sync Tracker State stage that owns post-PR tracker synchronization and terminal workspace cleanup.

## Requirements
### Requirement: Sync Tracker State Job Module
The system SHALL provide a `sync-tracker-state` job handled by an isolated Sync Tracker State module that owns post-pull-request tracker synchronization and terminal cleanup for pull-request-created paths.

#### Scenario: Sync Tracker State receives pull request data
- **WHEN** a `sync-tracker-state` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, issue data, repository identity, branch name, workspace path, and pull request result data
- **AND** `stage` SHALL be `sync-tracker-state`

#### Scenario: Tracker state is synchronized
- **WHEN** Sync Tracker State receives pull request data
- **THEN** it SHALL attempt the configured tracker-side effects for the source issue
- **AND** those side effects SHALL include moving the issue from `ready` to `in review` when GitHub label tracking is configured

#### Scenario: Tracker synchronization fails
- **WHEN** the pull request was created but tracker synchronization fails
- **THEN** Sync Tracker State SHALL keep the pull request result available to the run
- **AND** log the tracker synchronization failure
- **AND** SHALL NOT fabricate a failed pull request creation result

#### Scenario: Terminal workspace cleanup runs
- **WHEN** Sync Tracker State completes or fails after receiving a workspace path
- **THEN** it SHALL attempt to clean up that workspace path
- **AND** refuse to delete paths outside `/tmp`
- **AND** refuse to delete symbolic links

#### Scenario: Sync Tracker State module remains isolated
- **WHEN** Sync Tracker State behavior is implemented
- **THEN** Sync Tracker State-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `sync-tracker-state` jobs
