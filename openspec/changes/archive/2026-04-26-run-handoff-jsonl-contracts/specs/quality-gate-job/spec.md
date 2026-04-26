## MODIFIED Requirements

### Requirement: Quality Gate Job Module
The system SHALL provide a `quality-gate` job handled by an isolated Quality Gate module that reads development input from the JSONL ledger, appends formal quality output, and hands off to Review.

#### Scenario: Quality Gate receives development data
- **WHEN** a `quality-gate` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `quality-gate`
- **AND** Quality Gate SHALL read issue data, repository identity, branch name, workspace path, plan data, and development result data from the referenced JSONL record chain

#### Scenario: Stub quality gate completes
- **WHEN** substantive quality evaluation has not been implemented
- **THEN** Quality Gate SHALL append a formal stub passing quality result to the JSONL ledger
- **AND** preserve the run, issue, repository, branch, workspace, plan, development, and attempt data in the ledger output needed by later stages

#### Scenario: Review is enqueued
- **WHEN** Quality Gate completes successfully and appends its handoff record
- **THEN** it SHALL enqueue a `review` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** set the next payload `stage` to `review`

#### Scenario: Quality Gate module remains isolated
- **WHEN** Quality Gate behavior is implemented
- **THEN** Quality Gate-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `quality-gate` jobs

