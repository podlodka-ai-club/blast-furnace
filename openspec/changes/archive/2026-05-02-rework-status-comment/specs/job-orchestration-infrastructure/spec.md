## MODIFIED Requirements

### Requirement: Deterministic Status Checklist
The system SHALL maintain a deterministic status checklist for the user-facing run status.

#### Scenario: Initial checklist is created
- **WHEN** the initial status comment is created after task pickup
- **THEN** the checklist SHALL include stable attempt-aware item ids for `task-pickup:attempt-1`, `prepare-run:attempt-1`, `assess:attempt-1`, `plan:attempt-1`, `develop:attempt-1`, `quality-gate:attempt-1`, `review:attempt-1`, and `draft-pr-and-in-review:attempt-1`
- **AND** `task-pickup:attempt-1` SHALL be marked `completed`
- **AND** downstream items SHALL be marked `pending` unless a later stage update has already occurred

#### Scenario: Checklist row kinds are presentation state
- **WHEN** orchestration status state is created or updated
- **THEN** status item stages SHALL be treated as tracker presentation row kinds
- **AND** status item stages SHALL NOT be treated as equivalent to workflow routing stages
- **AND** workflow routing SHALL continue to use queue payloads, handoff records, and `WorkflowStage` values

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

#### Scenario: Rework checklist rows use scoped ids
- **WHEN** a human rework attempt creates or updates status checklist rows
- **THEN** each rework checklist item SHALL include the active `reworkAttempt`
- **AND** each rework checklist item id SHALL include the active rework scope, stage row kind, and per-stage attempt
- **AND** `stageAttempt: 1` in one rework SHALL NOT collide with `stageAttempt: 1` in the original run or another rework
- **AND** the original checklist items SHALL remain in the status history

#### Scenario: Rework checklist is initialized before route-specific execution
- **WHEN** a rework trigger with qualifying human comments is accepted
- **THEN** the checklist SHALL upsert rework-scoped rows for Human Review, Prepare Run, Plan, Develop, Quality Gate, Code Review, and Make PR
- **AND** the Human Review row SHALL use label `Human Review`, state `retrying`, and detail `Rework needed`
- **AND** the Plan row SHALL be present even when the final rework route is not yet known

#### Scenario: Direct Develop rework skips Plan visibly
- **WHEN** a rework routes directly to Develop
- **THEN** the rework-scoped Plan row SHALL be updated to state `skipped`
- **AND** the Plan row status detail SHALL be `skipped`
- **AND** the update SHALL use the same `reworkAttempt` scope as the active rework

#### Scenario: Review rework expands checklist idempotently
- **WHEN** Review routes work back to Develop for rework
- **THEN** the checklist SHALL upsert rework item ids for the matching rework scope and per-stage attempt
- **AND** scoped rework item ids SHALL include the active `reworkAttempt`, such as `rework-M:develop:attempt-N`, `rework-M:quality-gate:attempt-N`, and `rework-M:review:attempt-N`
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

#### Scenario: Rework attempt sections are rendered separately
- **WHEN** one or more rework-scoped checklist rows exist
- **THEN** the status card SHALL render one subsection per `reworkAttempt`
- **AND** each subsection SHALL explain that human review comments were left during review and the work is being redone
- **AND** each subsection SHALL render a separate table with status icon, stage label, and short status detail columns
- **AND** the first data row in each rework table SHALL be `🟡 | Human Review | Rework needed |`
- **AND** rework-scoped checklist rows SHALL NOT be inserted as peer rows in the main progress table

#### Scenario: Review feedback loop is rendered separately
- **WHEN** one or more Review rework attempts exist and no rework-scoped checklist rows exist
- **THEN** the status card SHALL render a separate `Review feedback loop` table
- **AND** SHALL NOT insert every rework item as a peer row in the main progress table
- **AND** the feedback loop table SHALL include Attempt, Develop, Quality Gate, and Code Review columns
- **AND** the Code Review column SHALL include a status icon such as `🟡` for changes requested or `❌` for terminal Review exhaustion
