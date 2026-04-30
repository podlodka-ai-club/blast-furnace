## ADDED Requirements

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
- **AND** SHALL include a two-column metadata table with labels `Взято в работу` and `Последнее изменение`
- **AND** SHALL include a short blockquote describing the current focus, final state, or result

#### Scenario: Main progress table is rendered
- **WHEN** the main progress table is rendered
- **THEN** it SHALL use columns for status icon, stage label, and short status detail
- **AND** SHALL use status icons instead of textual `completed` or `pending` suffixes
- **AND** SHALL render completed items with `✅`, current in-progress items with `🔵`, retrying items with `🟡`, pending items with `⚪`, terminal failures with `❌`, skipped items with `⏭️`, and the aggregate review feedback loop row with `🔁`

#### Scenario: Review feedback loop is rendered separately
- **WHEN** one or more Review rework attempts exist
- **THEN** the status card SHALL render a separate `Review feedback loop` table
- **AND** SHALL NOT insert every rework item as a peer row in the main progress table
- **AND** the feedback loop table SHALL include Attempt, Develop, Quality Gate, and Review columns
- **AND** the Review column SHALL include a status icon such as `🟡` for changes requested or `❌` for terminal Review exhaustion
