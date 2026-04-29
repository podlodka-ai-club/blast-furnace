## MODIFIED Requirements

### Requirement: Review Job Module
The system SHALL provide a `review` job handled by an isolated Review module in the target workflow that reads passed quality input from a Develop-produced JSONL handoff record, reads accepted plan output through explicit dependency record ids when needed, and appends formal review output before handing off to Make PR.

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

#### Scenario: Review remains stubbed
- **WHEN** substantive review behavior has not been implemented
- **THEN** the Review module SHALL append formal stub review output to the JSONL ledger
- **AND** the Review output SHALL include review data only
- **AND** the Review output SHALL NOT preserve or duplicate run, issue, repository, branch, workspace, plan, development, quality, pull request, or tracker synchronization data
- **AND** the Review handoff record SHALL depend on the Develop input record and the accepted Plan record used by Review

#### Scenario: Make PR job is enqueued
- **WHEN** Review work completes and appends its handoff record
- **THEN** the Review module SHALL enqueue a `make-pr` job
- **AND** pass `runId`, `stage`, `stageAttempt`, `reworkAttempt`, and an input handoff record reference through the queue payload
- **AND** leave pull request work to the Make PR job

#### Scenario: Review module remains isolated
- **WHEN** Review behavior is implemented
- **THEN** Review-specific code SHALL live in its own job module
- **AND** worker routing SHALL call that module for `review` jobs
