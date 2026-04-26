# job-orchestration-infrastructure Specification

## Purpose
TBD - created by archiving change add-job-flow-work-infrastructure. Update Purpose after archive.
## Requirements
### Requirement: Shared Run File Infrastructure
The system SHALL provide shared infrastructure for run-scoped orchestration files without defining job-specific artifact contracts.

#### Scenario: Run directory paths are resolved
- **WHEN** job flow code needs a run-scoped filesystem location
- **THEN** the shared infrastructure SHALL resolve paths under `.orchestrator/runs/<runId>/`
- **AND** provide helpers for stage attempt directories, event file locations, and `run.json`
- **AND** keep the path convention independent of any specific job artifact set

#### Scenario: Immutable files are written
- **WHEN** the shared infrastructure writes an artifact or event file
- **THEN** it SHALL treat that file as append-only
- **AND** fail rather than overwrite an existing artifact or event file

#### Scenario: Run summary is updated
- **WHEN** the shared infrastructure writes run summary state
- **THEN** it SHALL write that state to `run.json`
- **AND** treat `run.json` as the only mutable file in the run directory

### Requirement: Flow and Work Job Units
The system SHALL structure target workflow job modules as separate flow and work units while preserving observable business behavior except for the intended workflow naming, payload envelope, and responsibility-boundary changes.

#### Scenario: Job flow invokes useful work
- **WHEN** a pipeline job handler receives a BullMQ job
- **THEN** the job-specific flow unit SHALL validate or normalize the incoming job data needed by that job
- **AND** invoke the job-specific work unit
- **AND** perform the downstream scheduling, cleanup, progress updates, and logging side effects owned by that stage

#### Scenario: Work unit stays stage-specific
- **WHEN** a job-specific work unit runs
- **THEN** it SHALL perform the useful business operation for that stage
- **AND** return a typed result to the flow unit
- **AND** SHALL NOT own generic run file path conventions

#### Scenario: Target behavior is preserved
- **WHEN** existing jobs are migrated to target workflow stages
- **THEN** worker routing SHALL call the target public job handlers
- **AND** queue payloads SHALL include the shared stage envelope
- **AND** stage-to-stage handoff SHALL remain queue-based
- **AND** current GitHub, git, temporary repository, and pull request behavior SHALL be preserved except where this change explicitly moves responsibility to Prepare Run, Develop, or Sync Tracker State

### Requirement: Job-Local Flow Ownership
The system SHALL keep stage transition logic local to each job's flow unit while sharing only common orchestration mechanics.

#### Scenario: A flow unit schedules the next job
- **WHEN** a job completes work that schedules another stage
- **THEN** that job's flow unit SHALL choose the target workflow next stage
- **AND** use shared orchestration infrastructure to schedule that next BullMQ job
- **AND** pass queue payload data that includes `runId`, `stage`, `stageAttempt`, and `reworkAttempt`

#### Scenario: Shared infrastructure is reused
- **WHEN** multiple job flow units need run file behavior
- **THEN** they SHALL use shared infrastructure for path conventions, append-only writes, generic artifact metadata, event metadata, and `run.json` updates
- **AND** SHALL NOT define incompatible per-job conventions for those common mechanics

### Requirement: Deferred Artifact Contracts
The system SHALL defer file-based handoff, concrete per-job artifact sets, and schema validation to later proposals while allowing queue payload changes required by the target workflow.

#### Scenario: Target workflow proposal is implemented
- **WHEN** this change is implemented
- **THEN** it SHALL NOT require Plan, Develop, Quality Gate, Review, Make PR, or Sync Tracker State to consume file paths or artifact references as their stage input contract
- **AND** SHALL keep downstream stage handoff in BullMQ payload data
- **AND** SHALL leave concrete artifact schemas, artifact selection rules, and schema validation for separate changes

### Requirement: Run Bootstrap Support
The system SHALL provide shared run mechanics that Prepare Run can use to initialize target workflow run state.

#### Scenario: Run summary is initialized
- **WHEN** Prepare Run starts a new run
- **THEN** shared infrastructure SHALL support writing an initial `run.json` for the received `runId`
- **AND** later stages SHALL be able to update the same run summary without replacing queue-based handoff

#### Scenario: Stage attempt paths use target stage names
- **WHEN** shared infrastructure resolves stage attempt paths
- **THEN** it SHALL support target workflow stage names
- **AND** the path SHALL include the run id, stage name, and domain stage attempt number
