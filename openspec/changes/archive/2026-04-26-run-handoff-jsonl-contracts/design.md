## Context

The current workflow has shared run-file helpers, a mutable `run.json`, append-only artifact/event helpers, and queue payloads that still carry the business state needed by downstream stages. The target direction for this change is narrower and more deterministic: one run-scoped JSONL file carries every stage output and every handoff record, while `run.json` is only a mutable status and pointer index.

This design intentionally removes per-stage JSON artifact files from the handoff model. Stage outputs are embedded in the JSONL records so the run has one chronological source of truth for what each stage produced and what the next stage consumed.

## Goals / Non-Goals

**Goals:**

- Store each run under `.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/` in the Blast Furnace repository, not in the cloned target repository workspace.
- Store the mutable run summary at `<YYYY-MM-DD_HH.MM_runId>_run.json` inside that directory.
- Store the append-only handoff ledger at `<YYYY-MM-DD_HH.MM_runId>_handoff.jsonl` inside that directory.
- Append one validated JSON object per stage transition, with the producing stage output embedded in the record.
- Make JSONL records explicitly depend on the previous stage record by stage name and record reference.
- Reduce stage queue payloads to transport fields plus an input handoff record reference.
- Validate stage output shape and handoff record shape before enqueueing the next stage.

**Non-Goals:**

- Do not introduce per-stage JSON artifact files for handoff data.
- Do not move logs, PTY output, or large raw command output into the JSONL ledger unless a compact summary or pointer is enough.
- Do not create `run.log` or a replacement runtime logging file for a run.
- Do not change the user-visible GitHub behavior of branch creation, Codex execution, PR creation, label transitions, or cleanup except where queue/file handoff mechanics require it.
- Do not implement the future clarify/rework loop beyond reserving output statuses and counters needed by the contracts.

## Decisions

### Timestamped Run Identity

Prepare Run will create a `RunFileSet` from a single timestamp and the `runId`.

```text
<blast-furnace>/.orchestrator/runs/<YYYY-MM-DD_HH.MM_runId>/
  <YYYY-MM-DD_HH.MM_runId>_run.json
  <YYYY-MM-DD_HH.MM_runId>_handoff.jsonl
```

The timestamp is computed once when the run is initialized and then persisted in `run.json`; all path helpers use the persisted value rather than recomputing time. The implementation should use UTC for the timestamp to avoid DST and host timezone ambiguity.

The cloned target repository workspace remains separate from orchestration storage. Its path is recorded in stage output so Codex and git operations can use it, but `.orchestrator/**` is not written into that workspace and must not be committed to the target repository.

Alternative considered: keep `.orchestrator/runs/<runId>/run.json`. That is simpler, but it does not satisfy chronological scanability from filenames and directories.

### Single JSONL Ledger As Source Of Truth

The handoff ledger is the only durable carrier for stage output and handoff data. Every line is one complete JSON record for one stage output plus the transition that record enables.

The record shape should include at least:

- `recordId`: stable id for this ledger line, such as `000001_prepare-run_to_assess`.
- `sequence`: monotonic 1-based line sequence.
- `runId`
- `createdAt`
- `fromStage`: producing stage.
- `toStage`: next stage, or `null` for terminal records.
- `stageAttempt`
- `reworkAttempt`
- `dependsOn`: `null` for the first record, otherwise `{ recordId, sequence, stage }`.
- `status`: `success`, `failure`, `blocked`, `clarify`, or `rework-needed`.
- `output`: the formal stage output object for `fromStage`.
- `nextInput`: compact metadata needed to enqueue the next stage, including the input record reference.

Alternative considered: write `stages/<stage>/attempt-<n>/artifacts/output.json` and keep JSONL as an index. That duplicates the same data and creates conflict over which file is authoritative, so this change rejects that model.

### Queue Payload Contract

Stage queue payloads should become transport-only:

```ts
{
  type: WorkflowStage;
  runId: string;
  stage: WorkflowStage;
  stageAttempt: number;
  reworkAttempt: number;
  inputRecordRef: {
    runDir: string;
    handoffPath: string;
    recordId: string;
    sequence: number;
    stage: WorkflowStage;
  };
}
```

Prepare Run is the exception on ingress because Intake must still provide the issue and configured repository identity needed to start a run. After Prepare Run appends the first JSONL record, all downstream stages read business state from the referenced JSONL record chain instead of queue payload fields.

Alternative considered: keep `inputArtifactRefs` in the payload. That name no longer matches the chosen design because stage JSON artifacts do not exist.

### Run Summary Responsibilities

The timestamped run summary file remains mutable and small. It should contain:

- `runId`
- `runStartedAt` and the timestamp prefix used in paths.
- `runDirectory`
- `handoffLedgerPath`
- current run status and current stage.
- per-stage attempt status.
- `stageAttempt` and `reworkAttempt` counters.
- latest handoff record pointer.

It should not duplicate full stage outputs from the JSONL ledger. It is an index for operators and recovery, not the source of handoff data.

### Validation Boundary

Each flow unit validates in this order:

1. Validate the incoming transport payload.
2. Resolve and read the input handoff record if the stage is not Prepare Run.
3. Validate that the input record's `toStage` matches the current stage.
4. Produce the stage output.
5. Validate the stage output schema.
6. Build and validate the handoff record.
7. Append the record to JSONL.
8. Update `run.json`.
9. Enqueue the next stage with the new `inputRecordRef`, when applicable.

This keeps invalid data from crossing a stage boundary.

### Schema Organization

Use TypeScript types plus runtime schemas for transport payloads, handoff records, run summary, and each stage output. The runtime schemas should live near the job/orchestration code and be reusable in tests. If a schema library is introduced, it should be limited to this validation layer and chosen for strict object validation and useful error messages.

## Risks / Trade-offs

- Ledger records can grow large if stage outputs include raw logs or process output -> keep records structured and summary-oriented, and store only bounded summaries or existing external log pointers.
- Appending and then enqueueing is not transactional with BullMQ -> append and update `run.json` before enqueueing, and make downstream stages idempotently consume the referenced record.
- A stage can receive a stale or wrong record reference -> validate `toStage`, `runId`, `stageAttempt`, and `reworkAttempt` before doing work.
- Timestamp-based paths can drift if recomputed -> compute once at run initialization and persist the path prefix in `run.json`.
- Removing business fields from queue payloads is an internal breaking change -> migrate one stage at a time behind tests that prove downstream stages read from JSONL.

## Migration Plan

1. Add path helpers for timestamped run directories, timestamped run summary files, and handoff JSONL files.
2. Add runtime schemas and types for `RunSummary`, `HandoffRecord`, `InputRecordRef`, and each stage output.
3. Update Prepare Run to create the timestamped run directory, write the initial run summary, append the first handoff record, and enqueue Assess with `inputRecordRef`.
4. Migrate Assess, Plan, Develop, Quality Gate, Review, Make PR, and Sync Tracker State to read their input from the JSONL ledger and append their own output record.
5. Update queue payload helpers and tests to remove downstream business fields from stage payloads.
6. Keep the target repository workspace free of `.orchestrator/**` and exclude any legacy target-workspace orchestration files from Make PR status/add operations.
7. Remove or stop using per-stage JSON artifact writes for handoff data.

Rollback is straightforward before deployment because this is an internal file and payload contract change. After deployment, rollback would need a compatibility reader that can process both the old business-field payloads and the new `inputRecordRef` payloads until in-flight jobs drain.

## Open Questions

- Should the timestamp format include UTC explicitly in a field inside `run.json` even though filenames use `YYYY-MM-DD_HH.MM`?
- Should terminal failure records use `toStage: null`, or should they target a reserved terminal stage name for easier querying?
