## ADDED Requirements

### Requirement: PR Rework Intake Job Module
The system SHALL provide a `pr-rework-intake` job handled by an isolated PR Rework Intake module that polls the pull request associated with a run after PR creation, detects terminal PR states and human rework triggers, and either closes the run or creates a rework handoff for Prepare Run.

#### Scenario: PR Rework Intake receives post-PR run data
- **WHEN** a `pr-rework-intake` job runs
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `pr-rework-intake`
- **AND** PR Rework Intake SHALL read issue data, repository identity, and pull request identity from the run summary and handoff ledger
- **AND** PR Rework Intake SHALL poll only the pull request associated with the referenced run

#### Scenario: Pull request remains open without trigger
- **WHEN** PR Rework Intake polls an open pull request that is not merged and does not have the `Rework` label
- **THEN** it SHALL enqueue another `pr-rework-intake` poll for the same run using the same interval as Intake
- **AND** it SHALL NOT append a handoff record for the idle poll
- **AND** it SHALL NOT create or prepare a workspace

#### Scenario: Pull request is merged
- **WHEN** PR Rework Intake polls a pull request that has been merged
- **THEN** it SHALL append a terminal successful `pr-rework-intake` handoff record
- **AND** it SHALL update the run summary to close the run successfully
- **AND** it SHALL NOT schedule more work for the run

#### Scenario: Pull request is closed without merge
- **WHEN** PR Rework Intake polls a pull request that is closed and not merged
- **THEN** it SHALL append a terminal `pr-rework-intake` handoff record with a closed-without-merge outcome
- **AND** it SHALL update the run summary to terminate the run as closed without merge
- **AND** it SHALL NOT schedule more work for the run

### Requirement: PR Rework Trigger Handling
The PR Rework Intake module SHALL consume human `Rework` label triggers, collect qualifying comments, run route analysis, and delegate to Prepare Run for workspace preparation.

#### Scenario: Rework trigger exceeds configured limit
- **WHEN** PR Rework Intake detects the `Rework` label and another rework would make the total number of full flow runs exceed `MAX_HUMAN_REWORK_ATTEMPTS`
- **THEN** it SHALL append a terminal `pr-rework-intake` handoff record with a too-many-reworks outcome
- **AND** it SHALL post a comment to the source issue stating that there were too many reworks
- **AND** it SHALL update the run summary to terminate the run
- **AND** it SHALL NOT schedule Prepare Run, Plan, or Develop

#### Scenario: Rework trigger has no qualifying comments
- **WHEN** PR Rework Intake detects the `Rework` label and no qualifying human comments are found
- **THEN** it SHALL remove the `Rework` label from the pull request
- **AND** it SHALL post a comment explaining that no review comments were found
- **AND** it SHALL append a non-continuing `pr-rework-intake` handoff record for the consumed no-comment trigger
- **AND** it SHALL enqueue the next PR Rework Intake poll
- **AND** it SHALL NOT schedule Prepare Run, Plan, or Develop

#### Scenario: Rework trigger produces route handoff
- **WHEN** PR Rework Intake detects the `Rework` label and qualifying human comments are found within the collection window
- **THEN** it SHALL render those comments into a single markdown document
- **AND** it SHALL render `prompts/review_comments_analysis.md` with the task title, task description, latest available accepted plan, and comments markdown
- **AND** it SHALL invoke Codex with the rendered prompt
- **AND** it SHALL route to `develop` only when the first line of the Codex response is exactly `ROUTE: DEVELOP`
- **AND** it SHALL route to `plan` when the first line is `ROUTE: PLAN` or any other value
- **AND** it SHALL append a `pr-rework-intake` handoff record containing the comments markdown, full Codex response, selected next stage, pull request identity, pull request head branch, expected head SHA, and latest accepted Plan record id
- **AND** it SHALL enqueue `prepare-run` with a reference to that handoff record
- **AND** the queued Prepare Run payload SHALL use incremented `reworkAttempt` and `stageAttempt: 1`

#### Scenario: Rework comment window is resolved
- **WHEN** PR Rework Intake collects comments for a rework
- **THEN** it SHALL use the `createdAt` of the previous rework-initiating `pr-rework-intake` handoff as the lower bound when one exists
- **AND** it SHALL collect all relevant comments when no previous rework-initiating handoff exists
- **AND** it SHALL collect comments up to the current moment

### Requirement: PR Rework Intake Idempotency
PR Rework Intake SHALL prevent duplicate delayed jobs, retries, or process crashes from appending duplicate terminal or rework handoff records.

#### Scenario: Duplicate rework intake job is active
- **WHEN** a PR Rework Intake job finds an active per-run lock or durable in-progress marker for the same run and action
- **THEN** it SHALL exit without appending a handoff record
- **AND** it SHALL NOT enqueue Prepare Run or another downstream stage

#### Scenario: Handoff exists but enqueue is missing
- **WHEN** PR Rework Intake finds that a terminal or rework handoff for the same run action already exists
- **AND** the expected next job has not been enqueued or may have been lost
- **THEN** it SHALL recover by enqueueing the next job from the existing handoff reference
- **AND** it SHALL NOT append a duplicate handoff record

#### Scenario: Handoff append and enqueue are ordered
- **WHEN** PR Rework Intake creates a terminal or rework decision
- **THEN** it SHALL append the handoff record before enqueueing the next job
- **AND** it SHALL persist enough pending-next-stage state in the run summary to recover enqueue after a crash
