# run-handoff-ledger Specification

## Purpose
TBD - created by archiving change run-handoff-jsonl-contracts. Update Purpose after archive.
## Requirements
### Requirement: Timestamped Run File Set
The system SHALL create a timestamped run file set for every accepted run.

#### Scenario: Run file set is initialized
- **WHEN** Prepare Run initializes a run with `runId`
- **THEN** the system SHALL create the run directory `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/` under the Blast Furnace repository root
- **AND** the timestamp portion SHALL be computed once for the run
- **AND** the timestamp portion SHALL be reused for all run-scoped file names
- **AND** the mutable run summary path SHALL be `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/YYYY-MM-DD_HH.MM_runId_run.json`
- **AND** the handoff ledger path SHALL be `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/YYYY-MM-DD_HH.MM_runId_handoff.jsonl`
- **AND** the system SHALL NOT create `run.log` or another run-level runtime logging file
- **AND** the cloned target repository workspace SHALL NOT contain `.orchestrator/**` due to run file initialization

#### Scenario: Timestamp metadata is persisted
- **WHEN** the run file set is initialized
- **THEN** the system SHALL persist the timestamp prefix, run directory path, run summary path, and handoff ledger path in the run summary
- **AND** later path resolution for the run SHALL use the persisted timestamp prefix rather than recomputing the current time

### Requirement: Single JSONL Handoff Ledger
The system SHALL use one append-only JSONL handoff ledger per run as the durable carrier for stage output and handoff data.

#### Scenario: Handoff record is appended
- **WHEN** a pipeline stage finishes with a handoff-relevant result
- **THEN** the system SHALL append exactly one JSON object as one line in the run's handoff JSONL file
- **AND** the appended record SHALL include the producing stage output needed by downstream stages or diagnostics
- **AND** the system SHALL NOT write duplicate per-stage JSON artifact files for the same handoff output

#### Scenario: Handoff record identifies transition
- **WHEN** a handoff record is appended
- **THEN** the record SHALL include `recordId`, `sequence`, `runId`, `createdAt`, `fromStage`, `toStage`, `stageAttempt`, `reworkAttempt`, `status`, `dependsOn`, `output`, and `nextInput`
- **AND** `toStage` SHALL be a workflow stage for non-terminal handoffs and `null` for terminal handoffs
- **AND** `nextInput` SHALL be a transport payload for non-terminal handoffs and `null` for terminal handoffs
- **AND** `sequence` SHALL be a monotonic one-based line sequence within the ledger
- **AND** `recordId` SHALL be stable and unique within the run

#### Scenario: First handoff record has no dependency
- **WHEN** Prepare Run appends the first handoff record for a run
- **THEN** the record's `dependsOn` value SHALL be `null`
- **AND** the record's `fromStage` SHALL be `prepare-run`
- **AND** the record's `toStage` SHALL be `assess` when preparation succeeds

#### Scenario: Later handoff records depend on prior record
- **WHEN** any stage after Prepare Run appends a handoff record
- **THEN** the record SHALL include a `dependsOn` object containing the previous record id, sequence, and stage
- **AND** the dependency SHALL identify the input record consumed by the producing stage

#### Scenario: Develop handoff includes passed quality
- **WHEN** Develop appends a successful handoff to Review
- **THEN** the record's `fromStage` SHALL be `develop`
- **AND** the record's `toStage` SHALL be `review`
- **AND** the record's `status` SHALL be `success`
- **AND** the record output SHALL include `development` and `quality`
- **AND** `quality.status` SHALL be `passed`

#### Scenario: Develop terminal handoff includes failed quality
- **WHEN** Develop appends a terminal handoff for `failed`, `timed-out`, or `misconfigured` quality
- **THEN** the record's `fromStage` SHALL be `develop`
- **AND** the record's `toStage` SHALL be `null`
- **AND** the record's `nextInput` SHALL be `null`
- **AND** the record output SHALL include `development` and `quality`
- **AND** the record output SHALL include a non-success Develop status that distinguishes the quality outcome

### Requirement: Handoff Schema Validation
The system SHALL validate transport payloads, input handoff records, stage outputs, and appended handoff records before crossing a stage boundary.

#### Scenario: Stage input is validated
- **WHEN** a stage receives a queue payload with an input record reference
- **THEN** the system SHALL validate the queue payload shape
- **AND** read the referenced JSONL record
- **AND** validate that the record's `runId`, `toStage`, `stageAttempt`, and `reworkAttempt` match the receiving stage context

#### Scenario: Stage output is validated before append
- **WHEN** a stage produces output
- **THEN** the system SHALL validate that output against the schema for the producing stage
- **AND** SHALL fail the stage before enqueueing the next stage when validation fails

#### Scenario: Handoff record is validated before enqueue
- **WHEN** a stage builds a handoff record
- **THEN** the system SHALL validate the full handoff record before appending it
- **AND** SHALL append the record before enqueueing the next stage
- **AND** SHALL enqueue the next stage only with a reference to the appended record

#### Scenario: Develop quality output schema is validated
- **WHEN** Develop appends any handoff record after Codex exits successfully
- **THEN** the Develop output schema SHALL require `development`
- **AND** SHALL require `quality.status` to be one of `passed`, `failed`, `misconfigured`, or `timed-out`
- **AND** SHALL require `quality.command`, `quality.attempts`, `quality.durationMs`, and `quality.summary`
- **AND** SHALL allow `quality.exitCode` and `quality.outputPath` when available

#### Scenario: Review input quality schema is validated
- **WHEN** Review receives a handoff record reference
- **THEN** the referenced record SHALL be produced by `develop`
- **AND** the referenced output SHALL include `quality.status: "passed"`
- **AND** validation SHALL reject missing quality data or non-passed quality data before Review appends output

### Requirement: Run Summary Pointer Index
The timestamped run summary SHALL remain a mutable status and pointer index over the handoff ledger.

#### Scenario: Run summary is updated after append
- **WHEN** the system appends a handoff record
- **THEN** it SHALL update the run summary with the current run status, current stage, stage attempt status, attempt counters, handoff ledger path, and latest handoff record reference
- **AND** it SHALL NOT duplicate full stage output data from the handoff ledger into the run summary

#### Scenario: Run summary is read for diagnostics
- **WHEN** an operator or recovery flow reads the run summary
- **THEN** the summary SHALL identify the active handoff ledger and latest relevant handoff record
- **AND** the detailed stage output SHALL be read from the JSONL ledger when needed

#### Scenario: Run summary records terminal quality outcome
- **WHEN** Develop appends a terminal handoff for a non-passed quality result
- **THEN** the run summary SHALL set `currentStage` to `null`
- **AND** the run summary status SHALL be `quality-failed`, `quality-timed-out`, or `quality-misconfigured` according to the quality result
- **AND** the latest handoff record reference SHALL point to the terminal Develop record
- **AND** the run summary SHALL NOT include a full copy of the quality command output
