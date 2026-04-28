# prepare-run-job Specification

## Purpose
Defines the target Prepare Run stage that initializes run state, prepares the issue branch, and creates the local workspace before assessment.
## Requirements
### Requirement: Prepare Run Job Module
The system SHALL provide a `prepare-run` job handled by an isolated Prepare Run module that initializes a timestamped run file set, prepares the configured repository workspace, records stable run context in the run summary, writes the first stage-local JSONL handoff record, and hands off to Assess.

#### Scenario: Prepare Run payload is created
- **WHEN** Intake accepts an eligible issue for automation
- **THEN** the system SHALL create a queue payload for `prepare-run`
- **AND** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** `stage` SHALL be `prepare-run`
- **AND** `stageAttempt` SHALL be `1`
- **AND** `reworkAttempt` SHALL be `0`
- **AND** the payload SHALL include the issue and configured repository identity needed to initialize the run

#### Scenario: Repository identity is mismatched
- **WHEN** Prepare Run receives a payload whose repository identity does not match the configured repository
- **THEN** Prepare Run SHALL fail before creating a branch, creating a workspace, cloning a repository, appending a successful handoff record, or enqueueing Assess

#### Scenario: Run metadata is initialized
- **WHEN** a `prepare-run` job starts
- **THEN** the Prepare Run module SHALL initialize run metadata for the received `runId`
- **AND** create `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/` under the Blast Furnace repository root
- **AND** write `<YYYY-MM-DD_HH.MM_runId>_run.json`
- **AND** create or prepare `<YYYY-MM-DD_HH.MM_runId>_handoff.jsonl`
- **AND** initialize stable run context with issue identity and configured repository identity
- **AND** SHALL NOT create `run.log` or any replacement run-level runtime logging file

#### Scenario: Branch name is prepared
- **WHEN** Prepare Run receives an issue
- **THEN** it SHALL build a branch name as `issue-{number}-{slugified-title}`
- **AND** validate the branch name before using it for GitHub or git operations

#### Scenario: Issue branch is prepared
- **WHEN** the target issue branch does not exist in the configured repository
- **THEN** Prepare Run SHALL create the target branch from the configured repository default base branch
- **AND** verify that the target branch exists in the configured repository
- **WHEN** the target issue branch already exists in the configured repository
- **THEN** Prepare Run SHALL reuse the branch
- **AND** verify that the target branch exists in the configured repository

#### Scenario: Local workspace is prepared
- **WHEN** branch preparation succeeds
- **THEN** Prepare Run SHALL create or prepare a local workspace for the run
- **AND** clone the configured repository into that workspace
- **AND** fetch the issue branch
- **AND** check out and reset the local branch to the remote issue branch
- **AND** the local workspace SHALL NOT contain `.orchestrator/**` from run metadata or handoff initialization

#### Scenario: Base context is recorded
- **WHEN** repository preparation succeeds
- **THEN** Prepare Run SHALL record branch name and workspace path in stable run context in the run summary
- **AND** the stable run context SHALL contain issue identity, configured repository identity, branch name, and workspace path before Assess is enqueued
- **AND** Prepare Run SHALL append the first JSONL handoff record with stage-local Prepare Run output only
- **AND** the first handoff record output SHALL NOT include assessment, plan, development, quality, review, pull request, or tracker synchronization output
- **AND** the first handoff record SHALL have `fromStage` set to `prepare-run`
- **AND** the first handoff record SHALL have `toStage` set to `assess`
- **AND** the first handoff record SHALL have `dependsOn` set to an empty array

#### Scenario: Assess is enqueued
- **WHEN** Prepare Run completes repository preparation and appends the first handoff record
- **THEN** it SHALL enqueue an `assess` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** the input handoff record reference SHALL point to the Blast Furnace repository's `.orchestrator/runs/...` paths rather than the local target repository workspace

#### Scenario: Preparation fails before handoff
- **WHEN** Prepare Run cannot prepare the run before enqueueing Assess
- **THEN** it SHALL fail the job
- **AND** attempt to clean up any workspace it created
- **AND** attempt to remove an issue branch only when that branch was created by the failed Prepare Run attempt

#### Scenario: Prepare Run module remains isolated
- **WHEN** Prepare Run behavior is implemented
- **THEN** Prepare Run-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `prepare-run` jobs

