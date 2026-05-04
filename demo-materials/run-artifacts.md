# Run Artifacts

Blast Furnace writes local run artifacts so each stage can be inspected, validated, retried, and recovered without relying only on private GitHub UI links.

## `run.json`

`run.json` is the run summary. It tracks stable input context, current status, stage attempts, rework attempts, tracker status, and pointers to the latest handoff record.

Sanitized excerpt:

```json
{
  "runId": "[REDACTED]",
  "status": "running",
  "stageAttempt": 1,
  "reworkAttempt": 1,
  "stages": {
    "intake": { "attempts": 1, "status": "success" },
    "prepare-run": { "attempts": 1, "status": "success" },
    "assess": { "attempts": 1, "status": "success" },
    "plan": { "attempts": 1, "status": "success" },
    "develop": { "attempts": 1, "status": "success" },
    "review": { "attempts": 1, "status": "success" },
    "make-pr": { "attempts": 1, "status": "success" },
    "sync-tracker-state": { "attempts": 1, "status": "success" },
    "pr-rework-intake": { "attempts": 1, "status": "rework-needed" }
  },
  "trackerStatus": {
    "heading": "Blast Furnace finalized PR rework",
    "focus": "Result: Pull request #43 updated"
  }
}
```

Sensitive fields such as repository owner, repository name, branch name, private URLs, local paths, and user handles were redacted.

## `handoff.jsonl`

`handoff.jsonl` is an append-only ledger. Each line records one deterministic handoff from one stage to the next, including sequence number, source stage, target stage, attempt numbers, dependencies, status, and stage output.

Sanitized excerpts:

```json
{"recordId":"000003_plan_to_develop","sequence":3,"fromStage":"plan","toStage":"develop","stageAttempt":1,"reworkAttempt":0,"dependsOn":["000002_assess_to_plan"],"status":"success","output":{"status":"success","plan":{"status":"success","summary":"Plan validated successfully."}}}
```

```json
{"recordId":"000006_make-pr_to_sync-tracker-state","sequence":6,"fromStage":"make-pr","toStage":"sync-tracker-state","stageAttempt":1,"reworkAttempt":0,"status":"success","output":{"status":"pull-request-created","pullRequest":{"number":43,"htmlUrl":"[REDACTED]"}}}
```

```json
{"recordId":"000008_pr-rework-intake_to_prepare-run","sequence":8,"fromStage":"pr-rework-intake","toStage":"prepare-run","stageAttempt":1,"reworkAttempt":1,"status":"rework-needed","output":{"status":"rework-needed","selectedNextStage":"develop","commentsMarkdown":"[REDACTED]"}}}
```

## Deterministic Validation Between Stages

Each stage output is parsed against the expected schema before the next stage consumes it. Downstream jobs receive typed references to prior handoff records rather than relying on ad hoc text. This makes the stage boundary explicit:

- Plan consumes Assess output.
- Develop consumes Plan output.
- Review consumes Develop and Quality Gate output.
- Make PR consumes Review output and repository state.
- PR rework intake records human feedback and selects the next stage.

## Quality Gate Output

Quality Gate results are stored in the handoff output and, when configured, can also be written as attempt logs. The recorded demo run included sanitized Quality Gate summaries:

- Initial implementation: passed, exit code 0, 23 test suites passed, 104 tests passed.
- Rework implementation: passed, exit code 0, 23 test suites passed, 107 tests passed.

The full command included a cache path and target workspace details, so those values are redacted here.

