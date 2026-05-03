## MODIFIED Requirements

### Requirement: Prepare Run Job Module
The system SHALL provide a `prepare-run` job handled by an isolated Prepare Run module that initializes run state for initial runs, prepares configured repository workspaces for initial and rework runs, records current workspace context in the run summary, writes stage-local JSONL handoff records, and hands off to the next workflow stage.

#### Scenario: Prepare Run payload is created
- **WHEN** Intake accepts an eligible issue for automation
- **THEN** the system SHALL create a queue payload for `prepare-run`
- **AND** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** `stage` SHALL be `prepare-run`
- **AND** `stageAttempt` SHALL be `1`
- **AND** `reworkAttempt` SHALL be `0`
- **AND** the payload SHALL include the issue and configured repository identity needed to initialize the run

#### Scenario: Rework Prepare Run payload is created
- **WHEN** PR Rework Intake delegates rework workspace preparation
- **THEN** the system SHALL create a queue payload for `prepare-run`
- **AND** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stageAttempt` SHALL be `1`
- **AND** `reworkAttempt` SHALL be incremented from the triggering PR Rework Intake context
- **AND** the input handoff record SHALL be produced by `pr-rework-intake`

#### Scenario: Repository identity is mismatched
- **WHEN** Prepare Run receives a payload whose repository identity does not match the configured repository
- **THEN** Prepare Run SHALL fail before creating a branch, creating a workspace, cloning a repository, appending a successful handoff record, or enqueueing a next stage

#### Scenario: Run metadata is initialized
- **WHEN** an initial `prepare-run` job starts
- **THEN** the Prepare Run module SHALL initialize run metadata for the received `runId`
- **AND** create `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/` under the Blast Furnace repository root
- **AND** write `<YYYY-MM-DD_HH.MM_runId>_run.json`
- **AND** create or prepare `<YYYY-MM-DD_HH.MM_runId>_handoff.jsonl`
- **AND** initialize stable run context with issue identity and configured repository identity
- **AND** SHALL NOT create `run.log` or any replacement run-level runtime logging file

#### Scenario: Branch name is prepared
- **WHEN** Prepare Run receives an initial issue
- **THEN** it SHALL build a branch name as `issue-{number}-{slugified-title}`
- **AND** validate the branch name before using it for GitHub or git operations

#### Scenario: Issue branch is prepared
- **WHEN** the target issue branch does not exist in the configured repository
- **THEN** Prepare Run SHALL create the target branch from the configured repository default base branch
- **AND** verify that the target branch exists in the configured repository
- **WHEN** the target issue branch already exists in the configured repository
- **THEN** Prepare Run SHALL reuse the branch
- **AND** verify that the target branch exists in the configured repository

#### Scenario: Initial local workspace is prepared
- **WHEN** initial branch preparation succeeds
- **THEN** Prepare Run SHALL create or prepare a local workspace for the run
- **AND** clone the configured repository into that workspace
- **AND** fetch the issue branch
- **AND** check out and reset the local branch to the remote issue branch
- **AND** the local workspace SHALL NOT contain `.orchestrator/**` from run metadata or handoff initialization

#### Scenario: Rework local workspace is prepared
- **WHEN** Prepare Run receives a valid PR Rework Intake handoff
- **THEN** it SHALL create or prepare a fresh local workspace for the run
- **AND** clone the configured repository into that workspace
- **AND** fetch the existing pull request head branch from the configured repository
- **AND** check out and reset the local branch to the expected pull request head SHA from the PR Rework Intake handoff
- **AND** reject fork pull request heads or head repositories that do not match the configured repository

#### Scenario: Base context is recorded
- **WHEN** initial repository preparation succeeds
- **THEN** Prepare Run SHALL record branch name and workspace path in stable run context in the run summary
- **AND** the stable run context SHALL contain issue identity, configured repository identity, branch name, and workspace path before Assess is enqueued
- **AND** Prepare Run SHALL append the first JSONL handoff record with stage-local Prepare Run output only
- **AND** the first handoff record output SHALL NOT include assessment, plan, development, quality, review, pull request, tracker synchronization, or PR Rework Intake output
- **AND** the first handoff record SHALL have `fromStage` set to `prepare-run`
- **AND** the first handoff record SHALL have `toStage` set to `assess`
- **AND** the first handoff record SHALL have `dependsOn` set to an empty array

#### Scenario: Rework context is recorded
- **WHEN** rework repository preparation succeeds
- **THEN** Prepare Run SHALL update the run summary with the current workspace path and pull request branch name
- **AND** Prepare Run SHALL append a stage-local Prepare Run handoff record
- **AND** the handoff record SHALL have `fromStage` set to `prepare-run`
- **AND** the handoff record SHALL have `toStage` set to the selected next stage from the PR Rework Intake handoff
- **AND** `toStage` SHALL be either `plan` or `develop`
- **AND** the handoff record SHALL depend on the consumed PR Rework Intake handoff record
- **AND** the handoff output SHALL NOT include plan, development, quality, review, pull request, tracker synchronization, comments markdown, Codex route-analysis response, or stable run context data

#### Scenario: Assess is enqueued
- **WHEN** initial Prepare Run completes repository preparation and appends the first handoff record
- **THEN** it SHALL enqueue an `assess` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** the input handoff record reference SHALL point to the Blast Furnace repository's `.orchestrator/runs/...` paths rather than the local target repository workspace

#### Scenario: Rework next stage is enqueued
- **WHEN** rework Prepare Run completes repository preparation and appends its handoff record
- **THEN** it SHALL enqueue the selected `plan` or `develop` job
- **AND** the queued payload SHALL pass `runId`, `stage`, `stageAttempt: 1`, `reworkAttempt`, and the Prepare Run handoff record reference

#### Scenario: Preparation fails before handoff
- **WHEN** Prepare Run cannot prepare the run before enqueueing the next stage
- **THEN** it SHALL fail the job
- **AND** attempt to clean up any workspace it created
- **AND** attempt to remove an issue branch only when that branch was created by the failed initial Prepare Run attempt

#### Scenario: Prepare Run module remains isolated
- **WHEN** Prepare Run behavior is implemented
- **THEN** Prepare Run-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `prepare-run` jobs
