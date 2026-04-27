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
- **WHEN** a job has type `quality-gate`
- **THEN** the worker SHALL route it to the Quality Gate handler
- **WHEN** a job has type `review`
- **THEN** the worker SHALL route it to the Review handler
- **WHEN** a job has type `make-pr`
- **THEN** the worker SHALL route it to the Make PR handler
- **WHEN** a job has type `sync-tracker-state`
- **THEN** the worker SHALL route it to the Sync Tracker State handler

#### Scenario: Unknown job type is received
- **WHEN** a job has an unrecognized type
- **THEN** the worker SHALL fail the job with an unknown job type error

## ADDED Requirements

### Requirement: Stage Queue Payload
The system SHALL use a shared queue payload envelope for workflow stage jobs.

#### Scenario: Stage payload is enqueued
- **WHEN** a workflow stage enqueues another workflow stage
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** the payload SHALL include the transitional business fields required by the next stage

#### Scenario: BullMQ retry stays internal
- **WHEN** BullMQ retries a failed job
- **THEN** the system SHALL keep BullMQ retry count separate from `stageAttempt`
- **AND** SHALL NOT derive `stageAttempt` from BullMQ retry metadata

#### Scenario: Stage attempt is carried
- **WHEN** a stage schedules the next stage in the normal forward path
- **THEN** the system SHALL carry the current `reworkAttempt`
- **AND** set the next stage payload `stageAttempt` to the domain attempt value for that next stage

#### Scenario: Transitional payload fields are allowed
- **WHEN** file-based handoff has not been implemented
- **THEN** workflow payloads MAY include issue, repository, branch, workspace, plan, development, quality, review, and pull request data needed by downstream stages
- **AND** those fields SHALL remain JSON-compatible
