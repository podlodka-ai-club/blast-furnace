## MODIFIED Requirements

### Requirement: Review Job Module
The system SHALL provide a `review` job handled by an isolated Review module in the target workflow that reads passed quality input from a Develop-produced JSONL handoff record and appends formal review output before handing off to Make PR.

#### Scenario: Review job receives Develop quality data
- **WHEN** a `review` job runs with a handoff record reference from `develop`
- **THEN** the payload SHALL include `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference
- **AND** `stage` SHALL be `review`
- **AND** Review SHALL read issue data, repository identity, branch name, workspace path, development data, and quality result data from the referenced JSONL record chain
- **AND** the referenced Develop output SHALL include `quality.status: "passed"`

#### Scenario: Review rejects non-passed quality
- **WHEN** a `review` job reads input without quality data or with `quality.status` other than `passed`
- **THEN** Review SHALL fail before appending review output
- **AND** SHALL NOT enqueue `make-pr`

#### Scenario: Review remains stubbed
- **WHEN** substantive review behavior has not been implemented
- **THEN** the Review module SHALL append formal stub review output to the JSONL ledger
- **AND** preserve the received run, issue, repository, branch, workspace, development, quality, and attempt data in the ledger output needed by later stages

#### Scenario: Make PR job is enqueued
- **WHEN** Review work completes and appends its handoff record
- **THEN** the Review module SHALL enqueue a `make-pr` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** leave pull request work to the Make PR job

#### Scenario: Review module remains isolated
- **WHEN** Review behavior is implemented
- **THEN** Review-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `review` jobs
