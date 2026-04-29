## MODIFIED Requirements

### Requirement: Shared Run File Infrastructure
The system SHALL provide shared infrastructure for timestamped run-scoped orchestration files, stable run context, and the single JSONL handoff ledger.

#### Scenario: Run directory paths are resolved
- **WHEN** job flow code needs a run-scoped filesystem location
- **THEN** the shared infrastructure SHALL resolve paths under `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/` in the Blast Furnace repository
- **AND** provide helpers for the timestamped run summary file and timestamped handoff JSONL file
- **AND** preserve the timestamp prefix created when the run was initialized
- **AND** downstream stages SHALL continue resolving that storage root from `inputRecordRef.runDir` rather than from the cloned target repository workspace

#### Scenario: Handoff records are appended
- **WHEN** the shared infrastructure writes handoff data for a stage transition
- **THEN** it SHALL append one JSON object as one line to the run's handoff JSONL file
- **AND** fail rather than overwrite or truncate existing handoff records
- **AND** SHALL write stage-local output only
- **AND** SHALL NOT persist `nextInput` in the handoff record
- **AND** SHALL NOT write per-stage JSON artifact files for handoff outputs
- **AND** SHALL NOT create `run.log` or another run-level runtime logging file

#### Scenario: Run summary is updated
- **WHEN** the shared infrastructure writes run summary state
- **THEN** it SHALL write that state to the timestamped `<YYYY-MM-DD_HH.MM_runId>_run.json`
- **AND** treat that run summary file as mutable
- **AND** keep stable run context in the run summary
- **AND** keep full stage output data in the JSONL handoff ledger rather than duplicating it in the run summary

### Requirement: Job-Local Flow Ownership
The system SHALL keep stage transition logic local to each job's flow unit while sharing only common orchestration mechanics.

#### Scenario: A flow unit schedules the next job
- **WHEN** a job completes work that schedules another stage
- **THEN** that job's flow unit SHALL choose the target workflow next stage
- **AND** use shared orchestration infrastructure to append the validated handoff record before scheduling that next BullMQ job
- **AND** pass queue payload data that includes `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** build that queue payload from the append result rather than from a persisted `nextInput` field

#### Scenario: Shared infrastructure is reused
- **WHEN** multiple job flow units need run file behavior
- **THEN** they SHALL use shared infrastructure for path conventions, handoff JSONL appends, handoff record metadata, event metadata, run summary updates, and stage context resolution
- **AND** SHALL NOT define incompatible per-job conventions for those common mechanics

#### Scenario: Stage context is resolved
- **WHEN** a job work unit needs inputs produced by earlier stages
- **THEN** shared infrastructure SHALL provide helpers that read stable run context from the run summary
- **AND** read only the required JSONL handoff records identified by the receiving stage's explicit dependency contract
- **AND** return typed stage context rather than a merged cumulative output snapshot
- **AND** fail when required dependency records are missing or invalid

### Requirement: Run Bootstrap Support
The system SHALL provide shared run mechanics that Prepare Run can use to initialize target workflow run state.

#### Scenario: Run summary is initialized
- **WHEN** Prepare Run starts a new run
- **THEN** shared infrastructure SHALL support writing an initial timestamped run summary file for the received `runId`
- **AND** the run summary SHALL be able to store stable run context for the accepted issue, configured repository, prepared branch, and workspace
- **AND** later stages SHALL be able to update the same run summary while using JSONL handoff records as the downstream stage output source

#### Scenario: Run file paths use target run naming
- **WHEN** shared infrastructure resolves run file paths
- **THEN** it SHALL support target workflow stage names
- **AND** the run directory and run file names SHALL include the timestamp prefix and run id
