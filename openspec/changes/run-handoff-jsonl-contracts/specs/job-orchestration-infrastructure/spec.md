## MODIFIED Requirements

### Requirement: Shared Run File Infrastructure
The system SHALL provide shared infrastructure for timestamped run-scoped orchestration files and the single JSONL handoff ledger.

#### Scenario: Run directory paths are resolved
- **WHEN** job flow code needs a run-scoped filesystem location
- **THEN** the shared infrastructure SHALL resolve paths under `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/`
- **AND** provide helpers for the timestamped run summary file and timestamped handoff JSONL file
- **AND** preserve the timestamp prefix created when the run was initialized

#### Scenario: Handoff records are appended
- **WHEN** the shared infrastructure writes handoff data for a stage transition
- **THEN** it SHALL append one JSON object as one line to the run's handoff JSONL file
- **AND** fail rather than overwrite or truncate existing handoff records
- **AND** SHALL NOT write per-stage JSON artifact files for handoff outputs

#### Scenario: Run summary is updated
- **WHEN** the shared infrastructure writes run summary state
- **THEN** it SHALL write that state to the timestamped `<YYYY-MM-DD_HH.MM_runId>_run.json`
- **AND** treat that run summary file as mutable
- **AND** keep full stage output data in the JSONL handoff ledger rather than duplicating it in the run summary

### Requirement: Job-Local Flow Ownership
The system SHALL keep stage transition logic local to each job's flow unit while sharing only common orchestration mechanics.

#### Scenario: A flow unit schedules the next job
- **WHEN** a job completes work that schedules another stage
- **THEN** that job's flow unit SHALL choose the target workflow next stage
- **AND** use shared orchestration infrastructure to append the validated handoff record before scheduling that next BullMQ job
- **AND** pass queue payload data that includes `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference

#### Scenario: Shared infrastructure is reused
- **WHEN** multiple job flow units need run file behavior
- **THEN** they SHALL use shared infrastructure for path conventions, handoff JSONL appends, handoff record metadata, event metadata, and run summary updates
- **AND** SHALL NOT define incompatible per-job conventions for those common mechanics

### Requirement: Run Bootstrap Support
The system SHALL provide shared run mechanics that Prepare Run can use to initialize target workflow run state.

#### Scenario: Run summary is initialized
- **WHEN** Prepare Run starts a new run
- **THEN** shared infrastructure SHALL support writing an initial timestamped run summary file for the received `runId`
- **AND** later stages SHALL be able to update the same run summary while using JSONL handoff records as the downstream stage input source

#### Scenario: Run file paths use target run naming
- **WHEN** shared infrastructure resolves run file paths
- **THEN** it SHALL support target workflow stage names
- **AND** the run directory and run file names SHALL include the timestamp prefix and run id

## REMOVED Requirements

### Requirement: Deferred Artifact Contracts
**Reason**: This change implements the previously deferred file-based handoff contract as a single per-run JSONL ledger instead of per-stage artifact files.

**Migration**: Use the `run-handoff-ledger` capability and timestamped run file set. Downstream stages consume referenced JSONL records rather than BullMQ business payloads or deferred artifact references.

