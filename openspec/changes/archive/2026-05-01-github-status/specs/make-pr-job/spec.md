## ADDED Requirements

### Requirement: Draft PR And Tracker Transition Status
The Make PR and tracker synchronization flow SHALL report a single user-facing final status item for Draft PR creation and moving the issue to `in review`.

#### Scenario: Final status item starts
- **WHEN** Make PR starts after a successful Review handoff
- **THEN** the flow SHALL update `draft-pr-and-in-review:attempt-1` to `in-progress`

#### Scenario: Pull request is created
- **WHEN** Make PR creates a pull request
- **THEN** the flow SHALL update `draft-pr-and-in-review:attempt-1` to `completed`
- **AND** the visible status detail SHALL identify that the pull request was created when pull request identity is available

#### Scenario: Issue is moved to in review after PR creation
- **WHEN** tracker synchronization moves the issue to `in review` after pull request creation
- **THEN** the flow SHALL keep `draft-pr-and-in-review:attempt-1` as `completed`
- **AND** SHALL update the visible status detail to show that the issue was moved to `in review`

#### Scenario: Issue transition fails after PR creation
- **WHEN** tracker synchronization fails to move the issue to `in review` after pull request creation
- **THEN** the flow SHALL keep `draft-pr-and-in-review:attempt-1` as `completed`
- **AND** SHALL include a visible warning or status note that the pull request was created but moving the issue to `in review` failed
- **AND** SHALL NOT change the final visible status item to `failed`

#### Scenario: Pull request is not created because there are no changes
- **WHEN** Make PR reaches the terminal no-change outcome
- **THEN** the flow SHALL update `draft-pr-and-in-review:attempt-1` to `skipped` or `completed` with a visible no-change result
- **AND** SHALL NOT report tracker synchronization as pending work

#### Scenario: Pull request creation fails
- **WHEN** git, push, or pull request creation fails before a pull request exists
- **THEN** the flow SHALL update `draft-pr-and-in-review:attempt-1` to `failed`
- **AND** SHALL NOT mark the item completed
