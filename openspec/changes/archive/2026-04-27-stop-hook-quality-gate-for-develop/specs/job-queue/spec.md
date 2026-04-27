## MODIFIED Requirements

### Requirement: Worker Processing
The system SHALL process jobs through a BullMQ worker using a type-dispatched job handler.

#### Scenario: Worker is created
- **WHEN** the worker is created without explicit options
- **THEN** it SHALL process the `agent-orchestrator` queue
- **AND** use concurrency `5`
- **AND** use a stalled interval of 60000 milliseconds

#### Scenario: Known job type is received
- **WHEN** a job has type `intake`
- **THEN** the worker SHALL route it to the Intake handler
- **WHEN** a job has type `prepare-run`
- **THEN** the worker SHALL route it to the Prepare Run handler
- **WHEN** a job has type `assess`
- **THEN** the worker SHALL route it to the Assess handler
- **WHEN** a job has type `plan`
- **THEN** the worker SHALL route it to the Plan handler
- **WHEN** a job has type `develop`
- **THEN** the worker SHALL route it to the Develop handler
- **WHEN** a job has type `review`
- **THEN** the worker SHALL route it to the Review handler
- **WHEN** a job has type `make-pr`
- **THEN** the worker SHALL route it to the Make PR handler
- **WHEN** a job has type `sync-tracker-state`
- **THEN** the worker SHALL route it to the Sync Tracker State handler

#### Scenario: Unknown job type is received
- **WHEN** a job has an unrecognized type
- **THEN** the worker SHALL fail the job with an unknown job type error

#### Scenario: Deprecated Quality Gate job type is received
- **WHEN** a job has type `quality-gate`
- **THEN** the worker SHALL fail the job as an unknown or unsupported active workflow job type

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

#### Scenario: Develop hands off directly to Review after passed quality
- **WHEN** Develop appends a passed quality handoff record
- **THEN** the next stage payload SHALL have `type: "review"` and `stage: "review"`
- **AND** the input record reference SHALL identify a record produced by `develop`
- **AND** the system SHALL NOT enqueue an intermediate `quality-gate` payload

#### Scenario: Terminal quality outcomes do not enqueue a stage payload
- **WHEN** Develop appends a terminal handoff record for `failed`, `timed-out`, or `misconfigured` quality
- **THEN** the record SHALL NOT produce a next stage payload
- **AND** no `review`, `make-pr`, or `sync-tracker-state` job SHALL be enqueued for that run path
