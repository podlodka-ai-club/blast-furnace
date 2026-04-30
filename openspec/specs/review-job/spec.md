# review-job Specification

## Purpose
Defines the Review stage, including read-only Codex review execution, deterministic response validation, Review rework routing, and handoff behavior to Make PR or terminal failure states.
## Requirements
### Requirement: Review Attempt Configuration
The system SHALL load `REVIEW_ATTEMPT_LIMIT` as a startup configuration value that limits Review-failure rework loops.

#### Scenario: Review attempt limit defaults
- **WHEN** `REVIEW_ATTEMPT_LIMIT` is unset
- **THEN** the configured review attempt limit SHALL default to `3`

#### Scenario: Review attempt limit is valid
- **WHEN** `REVIEW_ATTEMPT_LIMIT` is set to an integer from `1` through `19`
- **THEN** configuration loading SHALL accept the value
- **AND** Review SHALL use that value as the attempt limit

#### Scenario: Review attempt limit is invalid
- **WHEN** `REVIEW_ATTEMPT_LIMIT` is present and is not an integer from `1` through `19`
- **THEN** configuration loading SHALL fail startup with an error

### Requirement: Review Job Module
The system SHALL provide a `review` job handled by an isolated Review module in the target workflow that reads passed quality input from a Develop-produced JSONL handoff record, reads accepted plan output through explicit dependency record ids when needed, runs Codex review in read-only mode, validates Review output deterministically, appends formal review output, and either hands off to Make PR, routes Review failures back to Develop, or terminates the run.

#### Scenario: Review job receives Develop quality data
- **WHEN** a `review` job runs with a handoff record reference from `develop`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `review`
- **AND** Review SHALL read issue data, repository identity, branch name, and workspace path from stable run context in the run summary
- **AND** Review SHALL read development data and quality result data from the referenced Develop handoff record
- **AND** Review SHALL read accepted plan output from the explicit Plan dependency associated with the Develop input context
- **AND** the referenced Develop output SHALL include `quality.status: "passed"`

#### Scenario: Review rejects non-passed quality
- **WHEN** a `review` job reads input without quality data or with `quality.status` other than `passed`
- **THEN** Review SHALL fail before appending review output
- **AND** SHALL NOT enqueue `make-pr`
- **AND** SHALL NOT enqueue `develop`

#### Scenario: Review runs Codex in read-only mode
- **WHEN** Review starts substantive review work
- **THEN** the Review module SHALL load `prompts/review.md`
- **AND** SHALL send the prompt without template substitutions
- **AND** SHALL run Codex in the workspace path read from stable run context
- **AND** SHALL configure Codex with read-only sandbox behavior
- **AND** SHALL NOT include `--dangerously-bypass-approvals-and-sandbox`
- **AND** SHALL disable Codex hooks for Review
- **AND** SHALL validate Codex's final response when a final message is available

#### Scenario: Review accepts successful response
- **WHEN** Codex Review returns exactly `Review Success` as the only non-empty line after surrounding whitespace is trimmed
- **THEN** the Review module SHALL append a Review handoff record with `status: "success"`
- **AND** the Review output status SHALL be `success`
- **AND** the Review result status SHALL be `passed`
- **AND** the Review result summary SHALL be `Review Success`
- **AND** the Review output SHALL include review data only
- **AND** the Review output SHALL NOT preserve or duplicate run, issue, repository, branch, workspace, plan, development, quality, pull request, or tracker synchronization data
- **AND** the Review handoff record SHALL depend on the Develop input record and the accepted Plan record used by Review

#### Scenario: Review accepts failed response with retry budget
- **WHEN** Codex Review returns a first line exactly equal to `Review failed`
- **AND** additional non-empty review text follows that first line
- **AND** the Review job `stageAttempt` is less than the configured review attempt limit
- **THEN** the Review module SHALL append a Review handoff record with `status: "rework-needed"` and `toStage: "develop"`
- **AND** the Review output status SHALL be `review-failed`
- **AND** the Review result status SHALL be `failed`
- **AND** the Review result content SHALL contain the review failure text
- **AND** the Review handoff record SHALL depend on the Develop input record and the accepted Plan record used by Review
- **AND** the Review module SHALL enqueue a `develop` job with `stageAttempt` incremented by `1`
- **AND** the queued Develop job SHALL keep the same `reworkAttempt` value as the Review job
- **AND** the run summary SHALL remain non-terminal

#### Scenario: Review failure exhausts retry budget
- **WHEN** Codex Review returns a valid failed response
- **AND** the Review job `stageAttempt` is greater than or equal to the configured review attempt limit
- **THEN** the Review module SHALL append a terminal Review handoff record with `status: "failure"` and `toStage: null`
- **AND** the Review output status SHALL be `review-exhausted`
- **AND** the Review result status SHALL be `exhausted`
- **AND** the Review result summary SHALL be `Review failed and rework attempt limit was reached.`
- **AND** the Review result content SHALL contain the review failure text
- **AND** the run summary status SHALL be `review-exhausted`
- **AND** Review SHALL NOT enqueue `develop`, `make-pr`, or `sync-tracker-state`

#### Scenario: Review repairs malformed response
- **WHEN** Codex Review returns a response that is neither a valid success response nor a valid failed response
- **THEN** the Review module SHALL load `prompts/review-repair.md`
- **AND** SHALL send the repair prompt to the same Codex review session
- **AND** SHALL validate the repaired response with the same response parser
- **AND** SHALL continue as success or failed review when the repaired response is valid

#### Scenario: Review malformed response terminates after repair
- **WHEN** the repaired Review response is still malformed
- **THEN** the Review module SHALL append a terminal Review handoff record with `status: "failure"` and `toStage: null`
- **AND** the Review output status SHALL be `review-malformed`
- **AND** the Review result status SHALL be `malformed`
- **AND** the Review result raw response SHALL contain the repaired Codex response
- **AND** the run summary status SHALL be `review-malformed`
- **AND** Review SHALL NOT enqueue `develop`, `make-pr`, or `sync-tracker-state`

#### Scenario: Make PR job is enqueued
- **WHEN** Review work completes with a successful passed review output
- **THEN** the Review module SHALL enqueue a `make-pr` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** leave pull request work to the Make PR job

#### Scenario: Review module remains isolated
- **WHEN** Review behavior is implemented
- **THEN** Review-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `review` jobs
