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
The system SHALL structure pipeline job modules as separate flow and work units while preserving current observable behavior.

#### Scenario: Job flow invokes useful work
- **WHEN** a pipeline job handler receives a BullMQ job
- **THEN** the job-specific flow unit SHALL validate or normalize the incoming job data needed by that job
- **AND** invoke the job-specific work unit
- **AND** perform the same downstream scheduling, cleanup, progress updates, and logging side effects that the current handler performs

#### Scenario: Work unit stays stage-specific
- **WHEN** a job-specific work unit runs
- **THEN** it SHALL perform the useful business operation for that job
- **AND** return a typed result to the flow unit
- **AND** SHALL NOT own generic run file path conventions

#### Scenario: Existing behavior is preserved
- **WHEN** existing jobs are split into flow and work units
- **THEN** worker routing SHALL continue to call the same public job handlers
- **AND** existing job names SHALL remain unchanged
- **AND** current BullMQ payload shapes SHALL remain unchanged
- **AND** current downstream job scheduling decisions SHALL remain unchanged
- **AND** current GitHub, git, temporary repository, and label transition behavior SHALL remain unchanged

### Requirement: Job-Local Flow Ownership
The system SHALL keep stage transition logic local to each job's flow unit while sharing only common orchestration mechanics.

#### Scenario: A flow unit schedules the next job
- **WHEN** a job completes work that currently schedules another job
- **THEN** that job's flow unit SHALL choose the same next job as the current implementation
- **AND** use shared orchestration infrastructure to schedule that next BullMQ job
- **AND** pass the same input data that the current implementation passes

#### Scenario: Shared infrastructure is reused
- **WHEN** multiple job flow units need run file behavior
- **THEN** they SHALL use shared infrastructure for path conventions, append-only writes, generic artifact metadata, event metadata, and `run.json` updates
- **AND** SHALL NOT define incompatible per-job conventions for those common mechanics

### Requirement: Deferred Artifact Contracts
The system SHALL defer concrete per-job artifact sets and artifact transfer payload changes to later proposals.

#### Scenario: Infrastructure proposal is implemented
- **WHEN** this change is implemented
- **THEN** it SHALL NOT require Plan, Codex Provider, Review, Make PR, or Check PR to publish final domain-specific artifact sets
- **AND** SHALL NOT change downstream jobs to consume artifact references instead of their current BullMQ payload data
- **AND** SHALL leave concrete artifact schemas and artifact selection rules for separate job-specific changes

