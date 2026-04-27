# review-job Specification

## Purpose
TBD - created by archiving change add-pipeline-step-jobs. Update Purpose after archive.
## Requirements
### Requirement: Review Job Module
The system SHALL provide a `review` job handled by an isolated Review module in the target workflow that reads quality input from the JSONL ledger and appends formal review output before handing off to Make PR.

#### Scenario: Review job receives quality gate data
- **WHEN** a `review` job runs with a handoff record reference from `quality-gate`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `review`
- **AND** Review SHALL read issue data, repository identity, branch name, workspace path, development data, and quality result data from the referenced JSONL record chain

#### Scenario: Review remains stubbed
- **WHEN** substantive review behavior has not been implemented
- **THEN** the Review module SHALL append formal stub review output to the JSONL ledger
- **AND** preserve the received run, issue, repository, branch, workspace, development, quality, and attempt data in the ledger output needed by later stages

#### Scenario: Make PR job is enqueued
- **WHEN** Review work completes and appends its handoff record
- **THEN** the Review module SHALL enqueue a `make-pr` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** leave pull request work to the Make PR job

#### Scenario: Review module remains isolated
- **WHEN** Review behavior is implemented
- **THEN** Review-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `review` jobs

