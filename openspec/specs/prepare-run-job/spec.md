# prepare-run-job Specification

## Purpose
Defines the target Prepare Run stage that initializes run state, prepares the issue branch, and creates the local workspace before assessment.

## Requirements
### Requirement: Prepare Run Job Module
The system SHALL provide a `prepare-run` job handled by an isolated Prepare Run module that initializes a run and prepares the repository workspace before assessment, planning, or development work begins.

#### Scenario: Prepare Run payload is created
- **WHEN** Intake accepts an eligible issue for automation
- **THEN** the system SHALL create a queue payload for `prepare-run`
- **AND** the payload SHALL include `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** `stage` SHALL be `prepare-run`
- **AND** `stageAttempt` SHALL be `1`
- **AND** `reworkAttempt` SHALL be `0`
- **AND** the payload SHALL include the issue and target repository identity needed to prepare the run

#### Scenario: Run metadata is initialized
- **WHEN** a `prepare-run` job starts
- **THEN** the Prepare Run module SHALL initialize run metadata for the received `runId`
- **AND** write the initial `run.json`
- **AND** establish a run-level log target

#### Scenario: Branch name is prepared
- **WHEN** Prepare Run receives an issue
- **THEN** it SHALL build a branch name as `issue-{number}-{slugified-title}`
- **AND** validate the branch name before using it for GitHub or git operations

#### Scenario: Issue branch is prepared
- **WHEN** the target issue branch does not exist
- **THEN** Prepare Run SHALL create the target branch from the repository default base branch
- **AND** verify that the target branch exists
- **WHEN** the target issue branch already exists
- **THEN** Prepare Run SHALL reuse the branch
- **AND** verify that the target branch exists

#### Scenario: Local workspace is prepared
- **WHEN** branch preparation succeeds
- **THEN** Prepare Run SHALL create or prepare a local workspace for the run
- **AND** clone the target repository into that workspace
- **AND** fetch the issue branch
- **AND** check out and reset the local branch to the remote issue branch

#### Scenario: Base context is recorded
- **WHEN** repository preparation succeeds
- **THEN** Prepare Run SHALL record base run context containing at least the `runId`, issue, repository identity, branch name, and workspace path
- **AND** this record SHALL NOT replace queue-based stage handoff for this change

#### Scenario: Assess is enqueued
- **WHEN** Prepare Run completes repository preparation
- **THEN** it SHALL enqueue an `assess` job
- **AND** pass the prepared run, issue, repository, branch, workspace, `stageAttempt`, and `reworkAttempt` data through the queue payload

#### Scenario: Preparation fails before handoff
- **WHEN** Prepare Run cannot prepare the run before enqueueing Assess
- **THEN** it SHALL fail the job
- **AND** attempt to clean up any workspace it created
- **AND** attempt to remove an issue branch only when that branch was created by the failed Prepare Run attempt

#### Scenario: Prepare Run module remains isolated
- **WHEN** Prepare Run behavior is implemented
- **THEN** Prepare Run-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `prepare-run` jobs
