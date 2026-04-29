## Context

Review currently validates its input context, appends a stubbed successful review output, and enqueues Make PR. Develop currently consumes a successful Plan handoff directly, renders `prompts/develop.md` with `planContent`, runs Codex in the prepared workspace with the Quality Gate Stop hook, and appends a Develop handoff to Review when quality passes.

This change turns Review into an active Codex stage and adds a Review-to-Develop rework loop. The working copy remains the prepared target repository workspace recorded in the run summary; Review must not create or reset it. Handoff remains the durable cross-stage contract, so Review results and terminal failures must be represented as stage-local Review output rather than copied stable context or earlier stage outputs.

## Goals / Non-Goals

**Goals:**

- Run Codex review in read-only mode in the same workspace left by Develop.
- Render Review prompts from repository-owned prompt files.
- Classify Review Codex responses into success, review failure, or malformed response.
- Retry malformed responses once by sending the repair prompt to the same Review Codex session.
- Terminate permanently with a handoff record when Review cannot produce a valid response or when the configured rework attempt limit is reached.
- Route valid Review failures back to Develop with an incremented Develop `stageAttempt`.
- Let rework Develop consume the latest Plan result and Review result, render `prompts/develop-rework.md`, run Quality Gate, and continue through Review as usual.

**Non-Goals:**

- Changing BullMQ retry semantics or deriving domain attempts from BullMQ attempts.
- Reusing the Review Codex session in Develop.
- Reusing the Develop Codex session in Review.
- Adding template substitutions to `prompts/review.md`.
- Changing Prepare Run workspace preparation, branch checkout, commit, push, or pull request behavior.

## Decisions

### Run Review Codex in read-only mode

Review will use the Codex session infrastructure with `workspacePath` from stable run context, hooks disabled, and `outputLastMessage: true` so validation uses Codex's final response instead of PTY noise when available. Unlike Develop, Review must run Codex in read-only mode: the Review command must not include `--dangerously-bypass-approvals-and-sandbox`, and when the configured command is Codex it must include `--sandbox read-only` unless an equivalent explicit read-only sandbox argument is already present.

This likely requires extending `buildCodexSessionArgs` / `runCodexSession` with options for sandbox mode and bypass behavior instead of hardcoding bypass for every stage. Develop can keep its current permissive behavior, while Review explicitly requests read-only execution.

Alternative considered: run Review with the same permissive executor settings as Develop. That would make an implementation-review stage able to mutate the workspace it is judging, which conflicts with Review's role.

### Treat Review response validation as a small parser

Review response parsing will trim surrounding whitespace and accept exactly two formats:

- `Review Success` as the only non-empty line.
- A first line exactly equal to `Review failed` with additional non-empty review text after it.

Any other response is malformed. Review sends `prompts/review-repair.md` as the second prompt in the same logical Review Codex session and validates that response with the same parser. The implementation can follow the existing Plan session pattern: first send starts a session, the second send resumes/continues that session rather than starting a fresh review. If the repaired response is still malformed, Review appends a terminal handoff containing the repaired Codex response and does not enqueue another job.

Alternative considered: interpret partial matches such as lowercase success or prose containing the marker. Strict parsing is preferable because downstream control flow depends on deterministic stage outcomes.

### Validate a configurable Review attempt limit at startup

The review failure budget will be read from an environment-backed config value, `REVIEW_ATTEMPT_LIMIT`, defaulting to `3` when unset. App startup must validate the effective value as an integer in the inclusive range `1..19`; if the environment variable is present but invalid, less than `1`, or greater than or equal to `20`, config loading must throw and the app must terminate with an error.

Review compares `job.data.stageAttempt` from the Review input payload with this value. If the attempt is greater than or equal to the limit, Review appends a terminal failure handoff and stops. Otherwise it appends a Review failure handoff to Develop and enqueues Develop with `stageAttempt` set to `job.data.stageAttempt + 1`. `reworkAttempt` remains unchanged on the Review handoff and on the Develop queue payload; this loop uses `stageAttempt` only.

Alternative considered: keep the limit hardcoded in Review. Configuration keeps the production retry budget adjustable without code changes.

### Model Review output statuses explicitly

`ReviewResult` and `ReviewOutput` should stop being stub-only. Review output should distinguish successful reviews, valid review failures, malformed response terminal failures, and exhausted review failures while still keeping only Review-owned data in handoff.

Concrete Review schemas:

```ts
type ReviewOutputStatus =
  | 'success'
  | 'review-failed'
  | 'review-malformed'
  | 'review-exhausted';

type ReviewResult =
  | {
      status: 'passed';
      summary: 'Review Success';
    }
  | {
      status: 'failed';
      summary: string;
      content: string;
    }
  | {
      status: 'malformed';
      summary: string;
      rawResponse: string;
    }
  | {
      status: 'exhausted';
      summary: string;
      content: string;
    };

interface ReviewOutput {
  status: ReviewOutputStatus;
  runId: RunId;
  stageAttempt: number;
  reworkAttempt: number;
  review: ReviewResult;
}
```

Status mapping:

- Review success: `ReviewOutput.status = "success"`, `review.status = "passed"`, handoff `status = "success"`, `toStage = "make-pr"`, run summary remains `running`.
- Review failure with retry budget remaining: `ReviewOutput.status = "review-failed"`, `review.status = "failed"`, handoff `status = "rework-needed"`, `toStage = "develop"`, `reworkAttempt = job.data.reworkAttempt`, next Develop payload `stageAttempt = job.data.stageAttempt + 1`, next Develop payload `reworkAttempt = job.data.reworkAttempt`, run summary remains `running`.
- Malformed response after repair: `ReviewOutput.status = "review-malformed"`, `review.status = "malformed"`, handoff `status = "failure"`, `toStage = null`, terminal run summary `status = "review-malformed"`.
- Review failure with exhausted retry budget: `ReviewOutput.status = "review-exhausted"`, `review.status = "exhausted"`, handoff `status = "failure"`, `toStage = null`, terminal run summary `status = "review-exhausted"`.

The exhausted-review terminal output must use this shape:

```ts
{
  status: 'review-exhausted',
  runId,
  stageAttempt: job.data.stageAttempt,
  reworkAttempt: job.data.reworkAttempt,
  review: {
    status: 'exhausted',
    summary: 'Review failed and rework attempt limit was reached.',
    content: reviewFailureText,
  },
}
```

Alternative considered: store failed reviews as successful Review output and infer control flow from text. Explicit statuses make run summaries, tests, and recovery behavior inspectable.

### Let Develop resolve either Plan input or Review rework input

Develop will accept exactly two input record shapes:

- Initial Develop input: `inputRecordRef` points to a Plan handoff where `fromStage = "plan"`, `toStage = "develop"`, `ReviewOutput` is absent, `PlanOutput.status = "success"`, and `plan.status = "success"`. Develop reads `plan.content` directly from this input record and renders `prompts/develop.md`.
- Review rework input: `inputRecordRef` points to a Review handoff where `fromStage = "review"`, `toStage = "develop"`, `ReviewOutput.status = "review-failed"`, and `review.status = "failed"`. Develop reads the review failure text from this input record, then resolves the accepted Plan record from the Review record's explicit `dependsOn` entries.

For rework, Review-to-Develop handoff must include direct dependencies on both the Develop record that Review consumed and the accepted Plan record:

```ts
reviewRecord.dependsOn = [
  developRecord.recordId,
  planRecord.recordId,
]
```

Develop must not receive plan content, review content, or business data through the queue payload. The queue payload remains transport-only; all plan and review content must be resolved from JSONL handoff records.

When any Develop attempt appends a successful handoff to Review, the Review queue payload must use the same `stageAttempt` and `reworkAttempt` values as the Develop job that produced that handoff. This means the first Develop attempt enqueues the first Review attempt with `stageAttempt = 1`; if Review sends work back to Develop with `stageAttempt = 2`, the successful second Develop attempt enqueues the second Review attempt with `stageAttempt = 2`.

When rework Develop appends its next handoff to Review, its `dependsOn` should include the consumed Review record and the Plan record. This preserves the existing requirement that Review can resolve the accepted Plan through explicit Develop dependencies.

Alternative considered: enqueue rework Develop with the original Plan input and pass the Review result in queue payload fields. That would violate the transport-only queue contract and make the Review result less durable.

### Make PR accepts only passed Review handoffs

Make PR must treat the referenced Review handoff as valid only when `ReviewOutput.status === "success"` and `review.status === "passed"`. It must reject every other Review output status, including `review-failed`, `review-malformed`, and `review-exhausted`, even if a queue payload directly references such a record.

Alternative considered: rely on Review to enqueue Make PR only on success. That is necessary but not sufficient because queue payloads can be replayed or constructed incorrectly; Make PR should validate its own boundary.

### Keep Quality Gate and downstream flow unchanged after rework

Rework Develop still runs Codex in the prepared workspace, runs Quality Gate through the existing Stop hook, appends terminal quality failures without Review, and enqueues Review only after passed quality. Review then repeats the same parsing and routing behavior.

Alternative considered: bypass Quality Gate after rework and return directly to Review. That would weaken the current Develop contract that every Develop handoff to Review includes passed quality.

## Risks / Trade-offs

- Review prompt output can be verbose or contain formatting before the marker -> strict parsing plus one repair attempt provides deterministic recovery while limiting extra Codex cost.
- Review-to-Develop changes Develop's accepted input stage -> tests must cover both initial Plan input and Review rework input to avoid breaking existing Develop flow.
- Handoff output schema changes affect Make PR context resolution -> Make PR tests should assert only passed Review outputs can reach Make PR and still resolve Develop and Plan dependencies.
- Configuring an overly high rework limit can cause expensive loops -> default to a conservative value and keep BullMQ retries separate from domain stage attempts.
- Codex review execution uses the same workspace with uncommitted changes -> this is intentional, but Review must avoid repository preparation side effects.
