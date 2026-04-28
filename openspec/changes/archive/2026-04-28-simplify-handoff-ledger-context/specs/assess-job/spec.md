## MODIFIED Requirements

### Requirement: Assess Job Module
The system SHALL provide an `assess` job handled by an isolated Assess module that reads stable prepared run context from the run summary and appends formal assessment output before handing off to Plan.

#### Scenario: Assess receives prepared run data
- **WHEN** an `assess` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `assess`
- **AND** Assess SHALL validate that the referenced handoff record hands off from `prepare-run` to `assess`
- **AND** Assess SHALL read issue data, repository identity, branch name, and workspace path from stable run context in the run summary

#### Scenario: Stub assessment completes
- **WHEN** substantive assessment behavior has not been implemented
- **THEN** Assess SHALL append a formal stub assessment output record to the JSONL ledger
- **AND** the output SHALL include assessment data only
- **AND** the output SHALL NOT preserve or duplicate prepared run, issue, repository, branch, workspace, plan, development, quality, review, pull request, or tracker synchronization data
- **AND** the handoff record SHALL depend on the direct Prepare Run input record

#### Scenario: Plan is enqueued
- **WHEN** Assess completes successfully and appends its handoff record
- **THEN** it SHALL enqueue a `plan` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** set the next payload `stage` to `plan`

#### Scenario: Assess module remains isolated
- **WHEN** Assess behavior is implemented
- **THEN** Assess-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `assess` jobs
