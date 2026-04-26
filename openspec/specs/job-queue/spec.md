# Job Queue Specification

## Purpose
Defines the current BullMQ queue, worker routing, retry, retention, concurrency, and job logging behavior.
## Requirements
### Requirement: Queue Configuration
The system SHALL use a BullMQ queue named `agent-orchestrator` backed by Redis.

#### Scenario: Queue is created
- **WHEN** queue infrastructure is initialized
- **THEN** the queue SHALL connect using `REDIS_HOST`, `REDIS_PORT`, and optional `REDIS_PASSWORD`
- **AND** default jobs SHALL retry up to 3 attempts
- **AND** retry backoff SHALL be exponential with a 1000 millisecond initial delay

#### Scenario: Job retention applies
- **WHEN** jobs complete
- **THEN** completed jobs SHALL be removed after 100 jobs or 24 hours
- **WHEN** jobs fail
- **THEN** failed jobs SHALL be removed after 500 jobs or 7 days

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

### Requirement: Job Logging
The system SHALL log worker lifecycle events with job context.

#### Scenario: Worker events occur
- **WHEN** a job becomes active
- **THEN** the system SHALL log that the job started
- **WHEN** a job completes
- **THEN** the system SHALL log successful completion
- **WHEN** a job fails
- **THEN** the system SHALL log the failure message
- **WHEN** a job stalls
- **THEN** the system SHALL log that the job stalled and will be retried

#### Scenario: Progress cannot be serialized
- **WHEN** job progress logging cannot serialize the progress payload
- **THEN** the system SHALL log a warning
- **AND** SHALL NOT crash the worker

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
