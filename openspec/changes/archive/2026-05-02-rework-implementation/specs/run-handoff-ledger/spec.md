## ADDED Requirements

### Requirement: PR Rework Intake Handoff Records
The handoff ledger SHALL support PR Rework Intake records for post-PR polling outcomes and human rework routing.

#### Scenario: Rework route handoff is recorded
- **WHEN** PR Rework Intake creates a rework route handoff
- **THEN** the record SHALL have `fromStage: "pr-rework-intake"`
- **AND** the record SHALL have `toStage: "prepare-run"`
- **AND** the record SHALL have `status: "rework-needed"`
- **AND** the record SHALL include the comments markdown, full Codex route-analysis response, selected next stage, pull request identity, pull request head branch, expected head SHA, and latest accepted Plan record id
- **AND** the record SHALL NOT include workspace path, development output, quality output, review output, or tracker synchronization output

#### Scenario: Rework route dependencies are recorded
- **WHEN** PR Rework Intake creates a rework route handoff
- **THEN** the record SHALL depend on the consumed Sync Tracker State handoff
- **AND** it SHALL depend on the latest available accepted Plan record
- **AND** it SHALL depend on the previous rework-initiating PR Rework Intake handoff when one exists

#### Scenario: Terminal PR lifecycle handoff is recorded
- **WHEN** PR Rework Intake detects a merged pull request, closed-without-merge pull request, or too-many-reworks outcome
- **THEN** it SHALL append a terminal handoff record with `fromStage: "pr-rework-intake"` and `toStage: null`
- **AND** the record output SHALL include the terminal outcome and pull request identity
- **AND** the record output SHALL NOT include comments markdown unless the terminal outcome is caused by a consumed rework trigger

#### Scenario: No-comment trigger handoff is recorded
- **WHEN** PR Rework Intake consumes a `Rework` trigger with no qualifying comments
- **THEN** it SHALL append a `pr-rework-intake` handoff record
- **AND** the record output SHALL include a no-comments-found outcome and pull request identity
- **AND** the record SHALL NOT schedule Plan, Develop, or Prepare Run

### Requirement: Rework Prepare Run Handoff Records
The handoff ledger SHALL support Prepare Run records after PR Rework Intake has initiated a rework.

#### Scenario: Rework Prepare Run handoff is recorded
- **WHEN** Prepare Run prepares a rework workspace
- **THEN** the record SHALL have `fromStage: "prepare-run"`
- **AND** the record SHALL have `toStage` set to `plan` or `develop`
- **AND** the record SHALL depend on the consumed PR Rework Intake handoff
- **AND** the record SHALL use `stageAttempt: 1`
- **AND** the record SHALL preserve the current incremented `reworkAttempt`

#### Scenario: Stage input accepts rework Prepare Run handoff
- **WHEN** Plan or Develop receives a rework Prepare Run handoff reference
- **THEN** stage input validation SHALL accept `fromStage: "prepare-run"` when the record depends on a valid PR Rework Intake handoff
- **AND** validation SHALL require the payload `stageAttempt` and `reworkAttempt` to match the referenced Prepare Run handoff

### Requirement: Recoverable Handoff Enqueue
The handoff ledger and run summary SHALL support recovering a next-stage enqueue after a handoff has been appended.

#### Scenario: Pending next stage is persisted
- **WHEN** a stage appends a handoff before enqueueing a next job
- **THEN** the run summary SHALL record the handoff reference and pending next stage before the enqueue is attempted
- **AND** recovery SHALL be able to enqueue the pending next stage using only the run summary and handoff ledger

#### Scenario: Duplicate append is prevented during recovery
- **WHEN** recovery finds an existing handoff for a PR Rework Intake action
- **THEN** it SHALL reuse that handoff record for enqueue
- **AND** it SHALL NOT append another handoff record for the same action
