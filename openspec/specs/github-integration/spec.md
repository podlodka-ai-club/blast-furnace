# GitHub Integration Specification

## Purpose
Defines the current GitHub REST integration for issues, branch refs, pull requests, and issue label transitions.

## Requirements

### Requirement: GitHub Client
The system SHALL create a GitHub REST client authenticated with `GITHUB_TOKEN`.

#### Scenario: Client is created
- **WHEN** GitHub helper functions are used
- **THEN** they SHALL use an Octokit REST client configured with the loaded GitHub token

### Requirement: Issue Fetching
The system SHALL fetch GitHub issues from a configured or explicitly provided repository.

#### Scenario: Issues are fetched with filters
- **WHEN** issue filters include labels, state, assignee, since, milestone, owner, or repo
- **THEN** the system SHALL pass those filters to GitHub issue listing
- **AND** default owner and repo SHALL come from configuration when not overridden
- **AND** default state SHALL be `open`

#### Scenario: Since filter is invalid
- **WHEN** the `since` filter is not a valid date
- **THEN** the system SHALL omit the `since` filter from the GitHub request

#### Scenario: GitHub issue response is mapped
- **WHEN** GitHub returns issues
- **THEN** the system SHALL exclude pull request items
- **AND** map issue fields to `GitHubIssue`
- **AND** map missing bodies to `null`
- **AND** map labels to string label names
- **AND** map missing assignees to `null`

### Requirement: Branch References
The system SHALL manage GitHub branch refs through validated branch names.

#### Scenario: Branch name is unsafe
- **WHEN** a branch name is empty, contains `..`, starts with `-`, or contains whitespace
- **THEN** branch operations SHALL reject it as invalid

#### Scenario: Branch ref is read
- **WHEN** a valid branch name is requested
- **THEN** the system SHALL fetch `heads/{branchName}` from the configured repository
- **AND** return the referenced object SHA

#### Scenario: Branch is created
- **WHEN** a valid branch name and SHA are provided
- **THEN** the system SHALL create `refs/heads/{branchName}` in the configured repository

#### Scenario: Branch is deleted
- **WHEN** a valid branch name is provided
- **THEN** the system SHALL delete `heads/{branchName}` in the configured repository

### Requirement: Pull Request Creation
The system SHALL create pull requests in the configured GitHub repository.

#### Scenario: Pull request input is invalid
- **WHEN** title, head, or base is empty after trimming
- **THEN** the system SHALL reject pull request creation

#### Scenario: Pull request is created
- **WHEN** title, head, base, body, and draft options are provided
- **THEN** the system SHALL call GitHub pull request creation with those values
- **AND** default body SHALL be an empty string
- **AND** default draft SHALL be `false`
- **AND** return the pull request number and HTML URL

### Requirement: Issue Label Transition
The system SHALL move processed issues from `ready` to `in review` when requested.

#### Scenario: Issue is moved to review
- **WHEN** label transition is requested for an issue number
- **THEN** the system SHALL read the current labels
- **AND** remove the `ready` label
- **AND** add the `in review` label
- **AND** de-duplicate labels before setting them on the issue
- **AND** return the final label list
