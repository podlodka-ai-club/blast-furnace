## MODIFIED Requirements

### Requirement: Intake Strategy Selection
The system SHALL use polling as the only supported strategy for receiving GitHub issues.

#### Scenario: Application startup initializes intake
- **WHEN** the application starts
- **THEN** application startup SHALL schedule the repeatable issue watcher job
- **AND** startup SHALL NOT depend on a runtime issue strategy selection

#### Scenario: Legacy strategy environment variable is present
- **WHEN** `GITHUB_ISSUE_STRATEGY` is present in the environment
- **THEN** the system SHALL ignore it for intake selection
- **AND** the system SHALL use polling intake
- **AND** the system SHALL NOT emit a compatibility warning for that variable

### Requirement: Polling Watcher
The system SHALL poll GitHub for open issues labeled `ready`.

#### Scenario: Watcher is started
- **WHEN** intake is initialized
- **THEN** the system SHALL add a repeatable `issue-watcher` job
- **AND** the repeat interval SHALL be `GITHUB_POLL_INTERVAL_MS`
- **AND** the repeatable job id SHALL be `issue-watcher-repeatable`

#### Scenario: Polling state exists
- **WHEN** Redis contains a valid last poll timestamp
- **THEN** the watcher SHALL use it as the `since` filter

#### Scenario: Polling state is absent or invalid
- **WHEN** Redis does not contain a valid last poll timestamp
- **THEN** the watcher SHALL fetch matching open `ready` issues without a `since` filter

#### Scenario: Registered repositories exist
- **WHEN** Redis contains valid repository entries in `github:repos`
- **THEN** the watcher SHALL poll each registered repository

#### Scenario: No registered repositories exist
- **WHEN** Redis contains no valid repository entries
- **THEN** the watcher SHALL poll the configured `GITHUB_OWNER` and `GITHUB_REPO`

#### Scenario: Issues are found
- **WHEN** polling returns matching issues
- **THEN** the watcher SHALL enqueue one `issue-processor` job per issue
- **AND** each job SHALL include the mapped `GitHubIssue`
- **AND** the watcher SHALL store the current timestamp in Redis after processing

## REMOVED Requirements

### Requirement: GitHub Webhook Endpoint
**Reason**: Webhook intake is no longer part of the supported runtime contract; polling is the only supported intake path.
**Migration**: Use polling intake through the repeatable `issue-watcher` job. Register repositories through the polling repository management API or rely on the configured `GITHUB_OWNER` and `GITHUB_REPO` fallback.
