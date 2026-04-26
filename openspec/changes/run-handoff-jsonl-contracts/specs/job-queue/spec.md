## MODIFIED Requirements

### Requirement: Stage Queue Payload
The system SHALL use a shared transport-only queue payload envelope for workflow stage jobs after Prepare Run has written the initial handoff record.

#### Scenario: Stage payload is enqueued
- **WHEN** a workflow stage enqueues another workflow stage after a handoff record has been appended
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** the payload SHALL include an input handoff record reference
- **AND** the payload SHALL NOT include issue, repository, branch, workspace, plan, development, quality, review, or pull request data as primary handoff fields

#### Scenario: BullMQ retry stays internal
- **WHEN** BullMQ retries a failed job
- **THEN** the system SHALL keep BullMQ retry count separate from `stageAttempt`
- **AND** SHALL NOT derive `stageAttempt` from BullMQ retry metadata

#### Scenario: Stage attempt is carried
- **WHEN** a stage schedules the next stage in the normal forward path
- **THEN** the system SHALL carry the current `reworkAttempt`
- **AND** set the next stage payload `stageAttempt` to the domain attempt value for that next stage

#### Scenario: Initial Prepare Run payload carries bootstrap data
- **WHEN** Intake enqueues Prepare Run for an eligible issue
- **THEN** the Prepare Run payload MAY include the issue and configured repository identity needed to initialize the run
- **AND** Prepare Run SHALL write that bootstrap data into the first validated handoff record before enqueueing Assess

#### Scenario: Downstream payload references handoff record
- **WHEN** a stage after Prepare Run is enqueued
- **THEN** its payload SHALL include an input record reference containing the handoff ledger path, record id, sequence, and producing stage
- **AND** the receiving stage SHALL read business data from the referenced JSONL record chain

