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
- **WHEN** a job has type `issue-watcher`
- **THEN** the worker SHALL route it to the issue watcher handler
- **WHEN** a job has type `issue-processor`
- **THEN** the worker SHALL route it to the issue processor handler
- **WHEN** a job has type `plan`
- **THEN** the worker SHALL route it to the Plan handler
- **WHEN** a job has type `codex-provider`
- **THEN** the worker SHALL route it to the Codex provider handler
- **WHEN** a job has type `review`
- **THEN** the worker SHALL route it to the Review handler
- **WHEN** a job has type `make-pr`
- **THEN** the worker SHALL route it to the Make PR handler
- **WHEN** a job has type `check-pr`
- **THEN** the worker SHALL route it to the Check PR handler

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

