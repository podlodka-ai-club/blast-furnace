## Why

Rework currently needs clearer issue-visible progress without creating a separate comment flow from the normal orchestrator status comment. Human reviewers need to see that review feedback was received, that rework is underway, and which rework stages have actually run or been skipped.

## What Changes

- Reuse the normal orchestrator status comment for rework progress instead of creating a separate rework status comment.
- For each rework attempt, add a dedicated subsection explaining that human review comments were left and the work is being redone.
- For each rework attempt, render a separate status table that begins with the constant row `🟡 | Human Review | Rework needed |`.
- Populate each rework table with rows that reflect the actual rework flow state.
- Include all potential rework steps when the rework begins, including `Plan`, because the exact route is not known at the start.
- When a rework routes directly to `Develop`, automatically mark `Plan` as `⏭️` with status `skipped`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-orchestration-infrastructure`: Status comment rendering and checklist state management must support rework-attempt subsections and rework-specific status tables in the existing orchestrator status comment.
- `pr-rework-intake`: Rework trigger handling must initialize visible rework status state, including the human-review row and unknown-route stage list, before Prepare Run continues the rework flow.

## Impact

- Affected code: tracker status rendering, tracker status item model/update helpers, PR rework intake status updates, Prepare Run rework routing updates, Plan/Develop rework status transitions, and related tests.
- Affected GitHub surface: the existing source-issue orchestrator status comment body.
- No new external dependencies or GitHub comment kinds are expected.
