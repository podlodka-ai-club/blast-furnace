## Why

Blast Furnace currently ends the automated workflow after pull request creation and tracker synchronization, but real PR review often produces follow-up work before the issue can be considered complete. The system needs a controlled human rework loop that consumes PR review feedback, routes it to the right stage, limits repeated rework attempts, and updates the existing pull request instead of creating duplicate PRs.

## What Changes

- Add a PR Rework Intake stage that polls GitHub at the same frequency as Intake and detects appearance of the `Rework` trigger label on existing pull requests.
- Enforce the total allowed number of full flow runs from `MAX_HUMAN_REWORK_ATTEMPTS`, defaulting to `3`; a value of `3` allows the initial run plus exactly two rework runs, and execution terminates with an issue comment when another rework would exceed that total.
- Collect matching human-authored PR review comments and PR-level comments created after the previous rework trigger up to the current moment into a single markdown document.
- Define the previous rework trigger as the `createdAt` of the handoff entry that initiated the prior rework; for the first rework, collect all relevant comments.
- Exclude comments made by Blast Furnace itself, comments whose GitHub user type is `Bot`, outdated comments, resolved comments, and deleted comments.
- Render comment locations in the comments markdown when available; omit `File` and `Line` fields for comments that do not have those values.
- Analyze the collected comments with `prompts/review_comments_analysis.md` and route rework to either `plan` or `develop` based on the first line of the Codex response.
- Store the collected comments markdown and the full Codex analysis response in the handoff record used for rework routing.
- Make PR Rework Intake idempotent under duplicate delayed jobs by using a per-run lock or durable in-progress marker before it appends a terminal or rework handoff.
- Specify handoff append plus next-job enqueue as idempotent and recoverable so a crash after append does not create duplicate rework records or lose the next scheduled stage.
- Delegate from PR Rework Intake to Prepare Run so rework gets a fresh workspace checked out from the existing pull request branch before Plan or Develop runs.
- Increment `reworkAttempt` when passing execution from PR Rework Intake into Prepare Run.
- Allow Prepare Run to route execution to the selected rework path after workspace preparation, rather than always continuing to Assess.
- Reset `stageAttempt` to `1` when entering a rework Plan or Develop path.
- Resolve the latest available accepted plan for every rework: use the original plan for the first rework, use the most recently generated rework plan when prior reworks were routed through Plan, and keep using the original plan when prior reworks were routed only through Develop.
- Add a Plan rework path that renders `prompts/plan-rework.md` with task details, the latest available accepted plan, and review comments, then hands the resulting plan to Develop as usual.
- Add a Develop rework path that renders `prompts/develop-rework.md` with the latest available accepted plan and the review comments as `reviewContent`.
- Run every rework through the remaining normal stages, including Quality Gate and Review.
- When the rework flow reaches Make PR, verify the existing pull request head repository, branch name, and expected head SHA before committing and pushing changes to that branch instead of creating a new pull request.
- Reject rework finalization for fork pull requests, unexpected head repositories, unexpected branches, or unexpected head SHAs, and handle non-fast-forward push conflicts with a defined refetch-and-retry policy.
- Keep Sync Tracker State responsible for external tracker side effects and workspace cleanup after pull request creation or rework finalization; it does not poll for rework triggers, monitor pull request merge state, close the run, or initiate rework.
- After Sync Tracker State finishes post-PR tracker synchronization and cleanup, start PR Rework Intake as the continuing post-PR polling loop instead of treating Sync Tracker State as terminal by itself.
- Have PR Rework Intake monitor the pull request for merge and closed state; when the pull request is merged, the run is considered successful and is closed, and when the pull request is closed without merge, the run is terminated as closed without merge.
- Treat exceeding the configured rework limit as a terminal condition; stop the flow and post a comment stating that there were too many reworks.
- After completed rework is pushed, Sync Tracker State removes the `Rework` label from the pull request, sets the source issue status back to `in review`, and cleans up the workspace.
- If the trigger fires but no qualifying comments are found, do not schedule Plan or Develop; remove the `Rework` label and post a comment explaining that no review comments were found.

## Capabilities

### New Capabilities

- `pr-rework-intake`: Poll existing pull requests for merge state, closed-without-merge state, and the `Rework` trigger label after PR creation, close the run successfully when the pull request is merged, terminate the run when the pull request is closed without merge, validate rework eligibility and attempt limits, terminate with a too-many-reworks comment when another rework would exceed the configured limit, collect qualifying human PR comments, run route analysis, create the rework handoff idempotently under a per-run lock or durable in-progress marker, and delegate to Prepare Run with the existing pull request branch and selected next stage through a recoverable enqueue.

### Modified Capabilities

- `sync-tracker-state-job`: Preserve ownership of external tracker side effects and workspace cleanup, including rework completion side effects after Make PR pushes to an existing pull request branch; Sync Tracker State does not poll for rework triggers, monitor pull request merge state, collect review comments, run route analysis, close the run, or schedule rework stages.
- `prepare-run-job`: Support rework workspace preparation by cloning or checking out the existing pull request branch, preserving the PR Rework Intake handoff as input context, resetting `stageAttempt` to `1` for the selected rework Plan or Develop path, and routing to the selected next stage after preparation instead of always enqueueing Assess.
- `plan-job`: Support a rework planning mode that uses the latest available accepted plan and collected human review comments with the `prompts/plan-rework.md` template.
- `develop-job`: Support direct human-review rework input using `prompts/develop-rework.md`, resolve the latest available accepted plan, consume review comments as `reviewContent`, and continue through Quality Gate and Review as part of the full rework flow.
- `make-pr-job`: Support finalizing completed rework by validating the existing pull request head repository, branch name, and expected head SHA, committing and pushing to the existing pull request branch rather than creating a new pull request, rejecting unsafe fork or unexpected branch targets, handling non-fast-forward push conflicts with a defined refetch-and-retry policy, then handing off to Sync Tracker State for tracker side effects and cleanup.
- `github-integration`: Provide the required GitHub operations for polling pull requests, reading PR review comments and PR-level comments with authors, optional locations, active/resolved/outdated/deleted status, detecting trigger labels, excluding comments authored by Blast Furnace or users whose type is `Bot`, commenting on the source issue, removing the `Rework` label from a pull request, and updating source issue tracker labels.
- `run-handoff-ledger`: Preserve rework routing records that include both the collected comments markdown and the full Codex route-analysis response without embedding unrelated stage context.

## Impact

- Affected job modules: PR Rework Intake, Sync Tracker State, Prepare Run, Plan, Develop, and Make PR.
- Affected GitHub clients: pull request review comments, PR issue comments, labels, and issue comments/status transitions.
- Affected prompts: add or update `prompts/review_comments_analysis.md`, `prompts/plan-rework.md`, and `prompts/develop-rework.md`.
- Affected configuration: add `MAX_HUMAN_REWORK_ATTEMPTS` with a default of `3`.
- Affected queue and ledger contracts: post-PR polling lifecycle, per-run rework intake concurrency control, recoverable handoff append and enqueue, run closure from PR Rework Intake, rework handoff records, `reworkAttempt` propagation, and stage routing from a post-PR trigger.
