## MODIFIED Requirements

### Requirement: PR Rework Trigger Handling
The PR Rework Intake module SHALL consume human `Rework` label triggers, collect qualifying comments, run route analysis, update visible rework status, and delegate to Prepare Run for workspace preparation.

#### Scenario: Rework trigger exceeds configured limit
- **WHEN** PR Rework Intake detects the `Rework` label and another rework would make the total number of full flow runs exceed `MAX_HUMAN_REWORK_ATTEMPTS`
- **THEN** it SHALL append a terminal `pr-rework-intake` handoff record with a too-many-reworks outcome
- **AND** it SHALL post a comment to the source issue stating that there were too many reworks
- **AND** it SHALL update the run summary to terminate the run
- **AND** it SHALL NOT schedule Prepare Run, Plan, or Develop

#### Scenario: Rework trigger has no qualifying comments
- **WHEN** PR Rework Intake detects the `Rework` label and no qualifying human comments are found
- **THEN** it SHALL remove the `Rework` label from the pull request
- **AND** it SHALL post a comment to the pull request conversation explaining that no review comments were found
- **AND** it SHALL append a non-continuing `pr-rework-intake` handoff record for the consumed no-comment trigger
- **AND** it SHALL enqueue the next PR Rework Intake poll
- **AND** it SHALL NOT schedule Prepare Run, Plan, or Develop

#### Scenario: Rework trigger produces route handoff
- **WHEN** PR Rework Intake detects the `Rework` label and qualifying human comments are found within the collection window
- **THEN** it SHALL render those comments into a single markdown document
- **AND** it SHALL render `prompts/review_comments_analysis.md` with the task title, task description, latest available accepted plan, and comments markdown
- **AND** it SHALL invoke Codex with the rendered prompt
- **AND** it SHALL route to `develop` only when the first line of the Codex response is exactly `ROUTE: DEVELOP`
- **AND** it SHALL route to `plan` when the first line is `ROUTE: PLAN` or any other value
- **AND** it SHALL append a `pr-rework-intake` handoff record containing the comments markdown, full Codex response, selected next stage, pull request identity, pull request head branch, expected head SHA, and latest accepted Plan record id
- **AND** it SHALL update the existing source-issue status comment with a new rework section for the incremented `reworkAttempt`
- **AND** the new rework section SHALL include all possible rework rows, including Plan, before Prepare Run continues execution
- **AND** it SHALL enqueue `prepare-run` with a reference to that handoff record
- **AND** the queued Prepare Run payload SHALL use incremented `reworkAttempt` and `stageAttempt: 1`

#### Scenario: Rework comment window is resolved
- **WHEN** PR Rework Intake collects comments for a rework
- **THEN** it SHALL use the `createdAt` of the previous rework-initiating `pr-rework-intake` handoff as the lower bound when one exists
- **AND** it SHALL collect all relevant comments when no previous rework-initiating handoff exists
- **AND** it SHALL collect comments up to the current moment
