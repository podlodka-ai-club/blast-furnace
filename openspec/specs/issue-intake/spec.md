# Issue Intake Specification

## Purpose
Defines the current polling and webhook mechanisms that receive GitHub issues and enqueue them for processing.

## Requirements

### Requirement: Intake Strategy Selection
The system SHALL support polling and webhook strategies for receiving GitHub issues.

#### Scenario: Polling strategy is selected
- **WHEN** `GITHUB_ISSUE_STRATEGY` is absent or set to `polling`
- **THEN** application startup SHALL schedule the repeatable issue watcher job

#### Scenario: Webhook strategy is selected
- **WHEN** `GITHUB_ISSUE_STRATEGY` is set to `webhook`
- **THEN** the server SHALL register the GitHub webhook route
- **AND** application startup SHALL NOT schedule the polling watcher

### Requirement: Polling Watcher
The system SHALL poll GitHub for open issues labeled `ready`.

#### Scenario: Watcher is started
- **WHEN** polling is enabled
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

### Requirement: GitHub Webhook Endpoint
The system SHALL expose `POST /webhooks/github` for GitHub issue events when webhook intake is enabled.

#### Scenario: Signature secret is configured
- **WHEN** `GITHUB_WEBHOOK_SECRET` is configured
- **THEN** the endpoint SHALL require `x-hub-signature-256`
- **AND** validate the HMAC SHA256 signature against the raw request body using timing-safe comparison
- **AND** reject missing or invalid signatures with status `401`

#### Scenario: Signature secret is absent
- **WHEN** `GITHUB_WEBHOOK_SECRET` is not configured
- **THEN** the endpoint SHALL accept requests without signature validation

#### Scenario: Webhook payload is invalid
- **WHEN** the payload lacks `action` or `issue`
- **THEN** the endpoint SHALL respond with status `400`
- **WHEN** the issue lacks required id, number, title, created timestamp, or updated timestamp fields
- **THEN** the endpoint SHALL respond with status `400`

#### Scenario: Issue opened event is received
- **WHEN** a valid webhook payload has action `opened`
- **THEN** the endpoint SHALL map the webhook issue payload to `GitHubIssue`
- **AND** enqueue an `issue-processor` job
- **AND** respond with status `200` and `{ "received": true }`

#### Scenario: Non-opened issue event is received
- **WHEN** a valid webhook payload has an action other than `opened`
- **THEN** the endpoint SHALL acknowledge it with status `200`
- **AND** SHALL NOT enqueue an issue processor job
