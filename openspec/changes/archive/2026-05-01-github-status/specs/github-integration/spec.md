## ADDED Requirements

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
