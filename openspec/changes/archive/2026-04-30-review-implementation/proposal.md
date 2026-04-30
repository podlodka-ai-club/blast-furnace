## Why

The Review stage is currently stubbed, so the pipeline can pass work to Make PR without an actual implementation review. Implementing Review closes the Develop-to-Make-PR gap by requiring Codex review output, handling malformed review responses deterministically, and routing failed reviews back through Develop rework.

## What Changes

- Implement the Review stage so it runs Codex in read-only mode in the working copy left by Develop using the `prompts/review.md` template without template substitutions.
- Validate Codex review output as either exactly `Review Success` on a single line or a response whose first line is `Review failed` followed by review text.
- Retry one malformed review response by sending `prompts/review-repair.md` to the same Codex review session.
- Permanently terminate the flow when the repaired response is still malformed, appending the last Codex response to handoff.
- On `Review Success`, append successful review output and enqueue the normal next stage.
- On `Review failed`, check the `stageAttempt` from the Review input; terminate permanently when it is greater than or equal to the configured review attempt limit.
- When review fails and Develop still has retry budget, append the review result to handoff and enqueue Develop with the Review input `stageAttempt` incremented by 1 while leaving `reworkAttempt` unchanged.
- When any Develop attempt passes Quality Gate and enqueues Review, pass the same `stageAttempt` and `reworkAttempt` values from Develop to Review.
- Validate `REVIEW_ATTEMPT_LIMIT` on app startup as a positive integer below `20`, failing startup when configured with an invalid value.
- Require Make PR to accept only passed Review handoffs and reject all other Review statuses even if referenced by a queue payload.
- Extend Develop so it accepts either a successful Plan handoff for initial work or a failed Review handoff for rework; rework Develop resolves the accepted Plan through the Review handoff dependencies and renders `prompts/develop-rework.md` with the Plan content and Review result.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-job`: Replace stub review behavior with Codex-based review execution, review response validation, malformed-response repair, terminal failure handling, and Review-failure rework routing.
- `develop-job`: Add review-triggered rework behavior that uses the Develop rework prompt template with latest Plan content and review result context.
- `run-handoff-ledger`: Extend handoff requirements for review success, review terminal failures, malformed review responses, and review-to-develop rework transitions.

## Impact

- Affected code includes Review job execution, Develop prompt selection, Codex executor invocation paths, handoff context resolution, queue payload creation, run summary updates, output schemas, configuration, and tests.
- Affected prompt templates are `prompts/review.md`, `prompts/review-repair.md`, and `prompts/develop-rework.md`.
- The pipeline control flow changes for Review failures by looping back to Develop within an environment-configured stage attempt budget before continuing through Quality Gate and Review again.
