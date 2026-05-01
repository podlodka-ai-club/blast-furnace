# job-orchestration-infrastructure Specification

## Purpose
TBD - created by archiving change add-job-flow-work-infrastructure. Update Purpose after archive.
## Requirements
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

### Requirement: Tracker Client Boundary
The system SHALL provide a flat tracker client boundary for orchestrator interactions with external trackers.

#### Scenario: Status comment operation is exposed through tracker client
- **WHEN** orchestration flow code needs to create or update the run status comment
- **THEN** it SHALL call a tracker client operation equivalent to `createOrUpdateStatusComment`
- **AND** SHALL pass domain-level run, issue, repository, comment kind, checklist, timestamp, and summary data
- **AND** SHALL NOT require stage flow code to call GitHub-specific comment helpers directly

#### Scenario: Future tracker operations share the same boundary
- **WHEN** plan comments, rework-start comments, or tracker state transitions are added later
- **THEN** their operations SHALL be added to the same flat tracker client boundary
- **AND** SHALL use distinct comment or operation kinds so they do not conflict with orchestrator status comments

### Requirement: Status State Persistence
The system SHALL persist run status identity and rendered checklist state in the mutable run summary.

#### Scenario: Run summary stores tracker status metadata
- **WHEN** an external status comment is created or updated
- **THEN** the run summary SHALL store the tracker provider name, status comment kind, external comment identity, checklist state, created timestamp when available, and last-updated timestamp
- **AND** the handoff ledger SHALL remain the source of formal stage output records

#### Scenario: Run summary exists before initial status comment
- **WHEN** Intake accepts an issue for processing
- **THEN** orchestration infrastructure SHALL initialize the timestamped run file set and run summary before creating the initial external status comment
- **AND** the initial run summary SHALL contain stable issue and configured repository identity
- **AND** Prepare Run SHALL consume the existing run summary and continue repository preparation
- **AND** status identity SHALL NOT be stored only in Redis before Prepare Run

### Requirement: Deterministic Status Checklist
The system SHALL maintain a deterministic status checklist for the user-facing run status.

#### Scenario: Initial checklist is created
- **WHEN** the initial status comment is created after task pickup
- **THEN** the checklist SHALL include stable attempt-aware item ids for `task-pickup:attempt-1`, `prepare-run:attempt-1`, `assess:attempt-1`, `plan:attempt-1`, `develop:attempt-1`, `quality-gate:attempt-1`, `review:attempt-1`, and `draft-pr-and-in-review:attempt-1`
- **AND** `task-pickup:attempt-1` SHALL be marked `completed`
- **AND** downstream items SHALL be marked `pending` unless a later stage update has already occurred

#### Scenario: Checklist states are assigned
- **WHEN** orchestration status state is updated
- **THEN** each checklist item state SHALL be one of `pending`, `in-progress`, `completed`, `retrying`, `blocked`, `failed`, or `skipped`
- **AND** `failed` SHALL mean terminal workflow failure for the visible flow
- **AND** retryable attempt failures SHALL be represented as `retrying` instead of `failed`

#### Scenario: Status item is updated idempotently
- **WHEN** a worker retry or status update retry applies the same status transition more than once
- **THEN** the checklist item SHALL be upserted by stable item id
- **AND** duplicate checklist rows SHALL NOT be created
- **AND** stale status detail from a previous state SHALL NOT be preserved when the replacement item omits detail

#### Scenario: Review rework expands checklist idempotently
- **WHEN** Review routes work back to Develop for rework
- **THEN** the checklist SHALL upsert rework item ids for the matching attempt, including `develop:attempt-N`, `quality-gate:attempt-N`, and `review:attempt-N`
- **AND** the original Develop, Quality Gate, and Review items SHALL remain in the status history
- **AND** the downstream `draft-pr-and-in-review:attempt-1` item SHALL remain after the latest Review path

### Requirement: Status Card Rendering
The system SHALL render GitHub status comments as a polished status card suitable for stakeholders and developers.

#### Scenario: Status card omits redundant visible identifiers
- **WHEN** the status comment is rendered
- **THEN** the visible body SHALL NOT include the issue number as a separate metadata field
- **AND** SHALL NOT include the run id as a visible metadata field
- **AND** the hidden marker SHALL still include machine-readable run, repository, and issue identity

#### Scenario: Status card header is rendered
- **WHEN** the status comment is rendered
- **THEN** it SHALL include one top-level heading describing the current high-level outcome
- **AND** SHALL include a two-column metadata table with labels `Picked up` and `Last update`
- **AND** SHALL include a short blockquote describing the current focus, final state, or result

#### Scenario: Main progress table is rendered
- **WHEN** the main progress table is rendered
- **THEN** it SHALL use columns for status icon, stage label, and short status detail
- **AND** SHALL use status icons instead of textual `completed` or `pending` suffixes
- **AND** SHALL render completed items with `✅`, current in-progress items with `🔵`, retrying items with `🟡`, pending items with `⚪`, terminal failures with `❌`, skipped items with `⏭️`, and the aggregate review feedback loop row with `🔁`
- **AND** SHALL render the Review stage label as `Code Review`
- **AND** SHALL render the combined Draft PR / move issue to `in review` stage label as `Make PR`

#### Scenario: Review feedback loop is rendered separately
- **WHEN** one or more Review rework attempts exist
- **THEN** the status card SHALL render a separate `Review feedback loop` table
- **AND** SHALL NOT insert every rework item as a peer row in the main progress table
- **AND** the feedback loop table SHALL include Attempt, Develop, Quality Gate, and Code Review columns
- **AND** the Code Review column SHALL include a status icon such as `🟡` for changes requested or `❌` for terminal Review exhaustion

