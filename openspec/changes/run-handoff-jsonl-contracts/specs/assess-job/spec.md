## MODIFIED Requirements

### Requirement: Assess Job Module
The system SHALL provide an `assess` job handled by an isolated Assess module that reads prepared run input from the JSONL ledger and appends formal assessment output before handing off to Plan.

#### Scenario: Assess receives prepared run data
- **WHEN** an `assess` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `assess`
- **AND** Assess SHALL read issue data, repository identity, branch name, and workspace path from the referenced JSONL record chain

#### Scenario: Stub assessment completes
- **WHEN** substantive assessment behavior has not been implemented
- **THEN** Assess SHALL append a formal stub assessment output record to the JSONL ledger
- **AND** preserve the prepared run, issue, repository, branch, workspace, and attempt data in the ledger output needed by later stages

#### Scenario: Plan is enqueued
- **WHEN** Assess completes successfully and appends its handoff record
- **THEN** it SHALL enqueue a `plan` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** set the next payload `stage` to `plan`

#### Scenario: Assess module remains isolated
- **WHEN** Assess behavior is implemented
- **THEN** Assess-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `assess` jobs

