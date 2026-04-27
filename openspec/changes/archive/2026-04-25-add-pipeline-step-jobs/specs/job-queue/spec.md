## MODIFIED Requirements

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

#### Scenario: Unknown job type is received
- **WHEN** a job has an unrecognized type
- **THEN** the worker SHALL fail the job with an unknown job type error
