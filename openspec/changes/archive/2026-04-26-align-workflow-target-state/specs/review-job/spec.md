## MODIFIED Requirements

### Requirement: Review Job Module
The system SHALL provide a `review` job handled by an isolated Review module in the target workflow.

#### Scenario: Review job receives quality gate data
- **WHEN** a `review` job runs with queue data from `quality-gate`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, issue data, repository identity, branch name, workspace path, development data, and quality result data
- **AND** `stage` SHALL be `review`

#### Scenario: Review remains stubbed
- **WHEN** substantive review behavior has not been implemented
- **THEN** the Review module SHALL produce stub review data in its queue output
- **AND** preserve the received run, issue, repository, branch, workspace, development, quality, and attempt data

#### Scenario: Make PR job is enqueued
- **WHEN** Review work completes
- **THEN** the Review module SHALL enqueue a `make-pr` job
- **AND** pass review output through the queue payload
- **AND** leave pull request work to the Make PR job

#### Scenario: Review module remains isolated
- **WHEN** Review behavior is implemented
- **THEN** Review-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `review` jobs
