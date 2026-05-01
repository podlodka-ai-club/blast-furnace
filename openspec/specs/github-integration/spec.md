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
The system SHALL fetch GitHub issues from the configured repository only.

#### Scenario: Issues are fetched with filters
- **WHEN** issue filters include labels, state, assignee, since, or milestone
- **THEN** the system SHALL pass those filters to GitHub issue listing
- **AND** owner and repo SHALL come from configuration
- **AND** default state SHALL be `open`

#### Scenario: Repository override is attempted
- **WHEN** issue fetching is invoked with repository override data from a legacy or stale caller
- **THEN** the system SHALL NOT use that override for GitHub issue listing
- **AND** owner and repo SHALL come from configuration

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
The system SHALL manage GitHub branch refs in the configured repository through validated branch names.

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
- **THEN** the system SHALL call GitHub pull request creation with configured owner and repo
- **AND** default body SHALL be an empty string
- **AND** default draft SHALL be `false`
- **AND** return the pull request number and HTML URL

### Requirement: Issue Label Transition
The system SHALL move processed issues in the configured repository from `ready` to `in review` when requested.

#### Scenario: Issue is moved to review
- **WHEN** label transition is requested for an issue number
- **THEN** the system SHALL read the current labels from the configured repository
- **AND** remove the `ready` label
- **AND** add the `in review` label
- **AND** de-duplicate labels before setting them on the issue
- **AND** write the final labels to the configured repository
- **AND** return the final label list

### Requirement: Issue Comment Management
The system SHALL manage issue comments in the configured GitHub repository for tracker client operations.

#### Scenario: Issue comment is created
- **WHEN** a tracker operation requests a new issue comment body for an issue number
- **THEN** the GitHub integration SHALL create the comment in the configured owner and repository
- **AND** SHALL return the created comment identity and body

#### Scenario: Issue comment is updated
- **WHEN** a tracker operation requests an update for an existing issue comment identity
- **THEN** the GitHub integration SHALL update that comment in the configured owner and repository
- **AND** SHALL return the updated comment identity and body

#### Scenario: Issue comments are listed for recovery
- **WHEN** a tracker operation needs to recover from a missing persisted comment identity
- **THEN** the GitHub integration SHALL list comments for the configured owner, repository, and issue number
- **AND** SHALL NOT use repository override data from callers

### Requirement: Tracker Comment Marker Contract
The system SHALL identify orchestrator tracker comments by a strict hidden marker that distinguishes status comments from other current or future orchestrator comments.

#### Scenario: Status marker is rendered
- **WHEN** the GitHub-backed tracker client renders an orchestrator status comment
- **THEN** the first line SHALL be a hidden marker formatted as `<!-- blast-furnace:tracker-comment kind=orchestrator-status runId=<runId> owner=<owner> repo=<repo> issue=<number> -->`
- **AND** the marker fields SHALL match the run id, configured repository owner, configured repository name, and issue number for the status update
- **AND** the rendered body SHALL contain exactly one tracker marker

#### Scenario: Persisted comment is valid
- **WHEN** the run summary contains a persisted GitHub status comment identity
- **AND** GitHub returns that comment
- **AND** the comment marker has `kind=orchestrator-status`, the same run id, configured owner, configured repository, and issue number
- **THEN** the GitHub-backed tracker client SHALL update that comment

#### Scenario: Persisted comment is missing
- **WHEN** updating the persisted GitHub status comment identity returns a not-found result
- **THEN** the GitHub-backed tracker client SHALL list issue comments
- **AND** SHALL search for a marker with `kind=orchestrator-status`, the same run id, configured owner, configured repository, and issue number
- **AND** SHALL update the newest matching comment when one or more valid matches exist
- **AND** SHALL create a replacement status comment when no valid match exists

#### Scenario: Persisted comment marker is invalid
- **WHEN** the persisted GitHub status comment exists
- **AND** its tracker marker is missing, malformed, duplicated, or mismatched by kind, run id, owner, repository, or issue number
- **THEN** the GitHub-backed tracker client SHALL NOT update that invalid comment
- **AND** SHALL search issue comments for a valid status marker
- **AND** SHALL create a replacement status comment only when no valid marker match exists

#### Scenario: User edits visible status content
- **WHEN** a user edits the visible content of the status comment
- **AND** the hidden marker remains valid
- **THEN** the next status update SHALL replace the visible comment body with the freshly rendered status card
- **AND** SHALL preserve a valid hidden marker in the first line

#### Scenario: Non-recoverable GitHub error occurs
- **WHEN** GitHub returns a permission, validation, abuse, rate-limit, or other non-not-found error while updating the status comment
- **THEN** the GitHub-backed tracker client SHALL NOT search and recreate the comment as recovery
- **AND** SHALL surface the provider failure to the caller for logging and retry handling

