# plan-job Specification

## Purpose
TBD - created by archiving change add-pipeline-step-jobs. Update Purpose after archive.
## Requirements
### Requirement: Plan Job Module
The system SHALL provide a `plan` job handled by an isolated Plan module in the target workflow that reads assessed input from the JSONL ledger and appends formal plan output before handing off to Develop.

#### Scenario: Plan job receives assessed run data
- **WHEN** a `plan` job runs with a handoff record reference from `assess`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `plan`
- **AND** Plan SHALL read issue data, repository identity, branch name, workspace path, and assessment data from the referenced JSONL record chain

#### Scenario: Plan remains stubbed
- **WHEN** substantive planning behavior has not been implemented
- **THEN** the Plan module SHALL append formal stub plan output to the JSONL ledger
- **AND** preserve the received run, issue, repository, branch, workspace, assessment, and attempt data in the ledger output needed by later stages

#### Scenario: Develop job is enqueued
- **WHEN** Plan work completes and appends its handoff record
- **THEN** the Plan module SHALL enqueue a `develop` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** leave executor, quality, review, and pull request work to later pipeline jobs

#### Scenario: Future comment side effect is reserved
- **WHEN** Plan behavior is expanded later
- **THEN** the Plan module SHALL be the place for a future GitHub planning comment side effect
- **AND** this change SHALL NOT require that side effect to be implemented

#### Scenario: Plan module remains isolated
- **WHEN** Plan behavior is implemented
- **THEN** Plan-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `plan` jobs

