## ADDED Requirements

### Requirement: Assess Job Module
The system SHALL provide an `assess` job handled by an isolated Assess module that exists as a normal workflow stage after Prepare Run and before Plan.

#### Scenario: Assess receives prepared run data
- **WHEN** an `assess` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, issue data, repository identity, branch name, and workspace path
- **AND** `stage` SHALL be `assess`

#### Scenario: Stub assessment completes
- **WHEN** substantive assessment behavior has not been implemented
- **THEN** Assess SHALL create a stub assessment result in its queue output
- **AND** preserve the prepared run, issue, repository, branch, workspace, and attempt data needed by later stages

#### Scenario: Plan is enqueued
- **WHEN** Assess completes successfully
- **THEN** it SHALL enqueue a `plan` job
- **AND** pass assessment output through the queue payload
- **AND** set the next payload `stage` to `plan`

#### Scenario: Assess module remains isolated
- **WHEN** Assess behavior is implemented
- **THEN** Assess-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `assess` jobs
