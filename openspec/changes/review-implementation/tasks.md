## 1. Configuration and Shared Contracts

- [x] 1.1 Add `REVIEW_ATTEMPT_LIMIT` to application configuration with default `3` and validation for integer values from `1` through `19`.
- [x] 1.2 Add focused configuration tests for default, valid, non-integer, below-range, and above-range `REVIEW_ATTEMPT_LIMIT` values.
- [x] 1.3 Extend Review output and handoff status types to represent `success`, `review-failed`, `review-malformed`, and `review-exhausted` Review outcomes.
- [x] 1.4 Extend handoff validation schemas to reject Review outputs containing stable run context, Plan, Develop, Quality, Pull Request, or tracker output data.
- [x] 1.5 Add handoff schema tests for passed Review, failed Review rework, malformed Review terminal, exhausted Review terminal, and invalid Review output shapes.

## 2. Codex Session Execution

- [x] 2.1 Add executor options that allow callers to choose Codex sandbox mode, bypass behavior, hook enablement, and final-message capture without changing Develop defaults.
- [x] 2.2 Add executor argument-building tests proving Develop still uses permissive hook-enabled execution and Review uses read-only hook-disabled execution.
- [x] 2.3 Implement Review Codex invocation in the prepared workspace using `prompts/review.md` without template substitutions.
- [x] 2.4 Implement Review repair invocation that sends `prompts/review-repair.md` to the same logical Review Codex session after a malformed response.

## 3. Review Stage Behavior

- [x] 3.1 Implement the strict Review response parser for exact `Review Success` and first-line `Review failed` responses with non-empty review text.
- [x] 3.2 Add parser tests for valid success, valid failed review, surrounding whitespace, missing failure text, case mismatches, extra success text, and unrelated malformed responses.
- [x] 3.3 Replace stub Review output with passed Review handoff creation and Make PR enqueueing only after valid Review success.
- [x] 3.4 Implement Review-failed handoff creation with `status: "rework-needed"`, Develop enqueueing, incremented `stageAttempt`, unchanged `reworkAttempt`, and dependencies on consumed Develop and accepted Plan records.
- [x] 3.5 Implement terminal Review-exhausted handoff creation and run summary update when `stageAttempt` is greater than or equal to `REVIEW_ATTEMPT_LIMIT`.
- [x] 3.6 Implement terminal Review-malformed handoff creation and run summary update when the repaired response is still malformed.
- [x] 3.7 Add Review job tests for passed review, failed review with retry budget, exhausted review, repaired malformed-to-success, repaired malformed-to-failure, malformed-after-repair terminal failure, and non-passed quality rejection.

## 4. Develop Rework Flow

- [x] 4.1 Extend Develop input resolution to accept either a successful Plan handoff or a Review rework handoff while rejecting unsupported input records before Codex launch.
- [x] 4.2 Implement Review rework context resolution by reading Review failure text from the consumed Review record and resolving the accepted Plan record from explicit Review dependencies.
- [x] 4.3 Add `prompts/develop-rework.md` rendering with accepted Plan content and latest Review failure content, without queue-payload business data.
- [x] 4.4 Preserve Develop `stageAttempt` and `reworkAttempt` values when any Develop attempt appends a successful handoff to Review and enqueues Review.
- [x] 4.5 Ensure rework Develop handoffs depend on both the consumed Review record and the accepted Plan record.
- [x] 4.6 Add Develop tests for initial Plan input, Review rework input, missing Plan dependency, invalid Review rework status, rework prompt rendering, preserved attempt values, and rework handoff dependencies.

## 5. Make PR Boundary Validation

- [x] 5.1 Update Make PR input validation to accept only Review handoffs with `ReviewOutput.status === "success"` and `review.status === "passed"`.
- [x] 5.2 Add Make PR tests rejecting `review-failed`, `review-malformed`, `review-exhausted`, missing passed review data, and queue payloads that reference non-passed Review records.

## 6. Integration and Verification

- [x] 6.1 Add or update integration-style pipeline tests covering Review success through Make PR enqueueing and Review failure looping back through Develop.
- [x] 6.2 Add or update run summary tests for terminal `review-malformed` and `review-exhausted` statuses with latest handoff record pointers.
- [x] 6.3 Run targeted Vitest suites for config, executor argument building, handoff validation, Review, Develop, and Make PR.
- [x] 6.4 Run `npm test` after implementation and confirm the full test suite passes.
