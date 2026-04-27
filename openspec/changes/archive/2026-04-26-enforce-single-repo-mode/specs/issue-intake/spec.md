## MODIFIED Requirements

### Requirement: Polling Watcher
The system SHALL poll the configured GitHub repository for open issues labeled `ready` as the Intake stage.

#### Scenario: Watcher is started
- **WHEN** intake is initialized
- **THEN** the system SHALL add a repeatable `intake` job
- **AND** the repeat interval SHALL be `GITHUB_POLL_INTERVAL_MS`
- **AND** the repeatable job id SHALL be `intake-repeatable`

#### Scenario: Polling state exists
- **WHEN** Redis contains a valid last poll timestamp
- **THEN** the watcher SHALL use it as the `since` filter

#### Scenario: Polling state is absent or invalid
- **WHEN** Redis does not contain a valid last poll timestamp
- **THEN** the watcher SHALL fetch matching open `ready` issues without a `since` filter

#### Scenario: Repository registry data exists
- **WHEN** Redis contains repository entries in `github:repos`
- **THEN** the watcher SHALL ignore those entries
- **AND** the watcher SHALL poll only the configured `GITHUB_OWNER` and `GITHUB_REPO`

#### Scenario: Issues are found
- **WHEN** polling returns matching issues
- **THEN** the watcher SHALL enqueue one `prepare-run` job per issue
- **AND** each job SHALL include the mapped `GitHubIssue`, configured repository identity, `runId`, `stage`, `stageAttempt`, and `reworkAttempt`
- **AND** each job SHALL have `stage` set to `prepare-run`
- **AND** the watcher SHALL store the current timestamp in Redis after processing
