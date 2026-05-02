## ADDED Requirements

### Requirement: Pull Request Rework Polling
The GitHub integration SHALL provide configured-repository operations for polling pull request lifecycle and rework trigger state.

#### Scenario: Pull request state is read
- **WHEN** PR Rework Intake requests pull request state
- **THEN** the GitHub integration SHALL fetch the pull request from the configured owner and repository
- **AND** return pull request number, state, merged status, head repository identity, head branch, head SHA, labels, and HTML URL
- **AND** SHALL NOT use repository override data from callers

#### Scenario: Rework label is removed
- **WHEN** a workflow stage requests `Rework` label removal for a pull request
- **THEN** the GitHub integration SHALL remove the `Rework` label from the pull request issue in the configured repository
- **AND** SHALL tolerate the label already being absent as an idempotent success

### Requirement: Pull Request Review Comment Collection
The GitHub integration SHALL provide configured-repository operations for reading qualifying pull request review comments and pull request-level comments.

#### Scenario: Review comments are listed
- **WHEN** PR Rework Intake collects review comments for a pull request
- **THEN** the GitHub integration SHALL list pull request review comments for the configured owner and repository
- **AND** include author login, author user type, body, created timestamp, path, line when available, original line when available, outdated status when available, resolved status when available, and deletion visibility when available

#### Scenario: Pull request-level comments are listed
- **WHEN** PR Rework Intake collects pull request-level comments
- **THEN** the GitHub integration SHALL list issue comments for the pull request issue in the configured owner and repository
- **AND** include author login, author user type, body, and created timestamp

#### Scenario: Pull request conversation comment is created
- **WHEN** PR Rework Intake reports a consumed `Rework` trigger with no qualifying comments
- **THEN** the GitHub integration SHALL create an issue comment on the pull request issue in the configured owner and repository
- **AND** SHALL NOT create that no-comment explanation on the source issue

#### Scenario: Non-qualifying comments are excluded
- **WHEN** PR Rework Intake builds comments markdown
- **THEN** it SHALL exclude comments authored by Blast Furnace
- **AND** exclude comments whose GitHub user type is `Bot`
- **AND** exclude outdated comments
- **AND** exclude resolved comments
- **AND** exclude deleted comments

#### Scenario: Comment markdown includes optional locations
- **WHEN** PR Rework Intake renders a qualifying comment with file or line data
- **THEN** the markdown SHALL include `File` and `Line` fields only for values that exist
- **AND** comments without file or line data SHALL omit those fields
