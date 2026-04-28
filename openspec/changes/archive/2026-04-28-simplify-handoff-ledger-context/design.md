## Context

The current handoff ledger uses one JSONL line per stage transition, but each `output` is a cumulative snapshot built by spreading the previous stage output and adding the current stage result. The same record also stores `nextInput`, a queue payload-like object that mostly duplicates `toStage`, attempts, run identity, and the appended record reference.

This creates two overlapping channels for the same information: durable business context lives inside cumulative JSONL outputs, while transport metadata is partially duplicated in both the handoff record and the BullMQ payload. As more stages need different subsets of context, cumulative outputs make it unclear which stage produced which data and make schema validation less meaningful.

The proposed direction keeps the JSONL ledger append-only and durable, but makes each record represent only one stage's result. Stable run identity and runtime context move to `run.json`, and stages resolve the specific prior records they need through explicit dependency record ids.

## Goals / Non-Goals

**Goals:**

- Keep queue payloads transport-only: `runId`, stage envelope fields, and an input handoff record reference.
- Remove `nextInput` from persisted handoff records without losing the ability to enqueue downstream stages.
- Make every handoff `output` stage-local, so `fromStage` owns all fields inside that output.
- Store stable run context in `run.json`, including issue identity, configured repository identity, branch name, and workspace path.
- Let each stage read only the prior handoff records it needs, using explicit dependency record ids rather than scanning the whole ledger.
- Preserve the chronological JSONL ledger as the source of stage outputs and transition history.

**Non-Goals:**

- Do not change the target workflow order or the observable GitHub, git, Codex, PR, tracker, and cleanup behavior.
- Do not introduce per-stage artifact JSON files for handoff output.
- Do not make BullMQ payloads carry business data again.
- Do not implement a general graph database or query engine over run history.
- Do not require compatibility with already-running jobs unless a deployment plan explicitly chooses a dual reader.

## Decisions

### 1. Store stable run context in `run.json`

Add a stable context section to the run summary, for example:

```ts
stableContext: {
  issue: GitHubIssue;
  repository: GitHubRepo;
  branchName: string;
  workspacePath: string;
}
```

`issue` and `repository` are established when the run is accepted or initialized. `branchName` and `workspacePath` are established by Prepare Run after repository preparation succeeds. These fields are run identity/runtime context, not repeated stage output. Downstream stages read them from `run.json`.

Alternative considered: keep Prepare Run context in the first JSONL output and make all later stages depend on that record. That keeps the ledger self-contained, but it turns common run identity into another handoff artifact and forces every stage to carry or resolve the same base context. `run.json` already exists as mutable run state and pointer index, so it is the better home for stable run context.

### 2. Make `output` stage-local

Stage output schemas should stop extending previous stage outputs. A stage output contains only that stage's formal result plus status and attempt metadata that belong to the record.

Expected shape by stage:

- Prepare Run: preparation result only; stable branch/workspace context is stored in `run.json`.
- Assess: `assessment`.
- Plan: `plan`.
- Develop: `development` and `quality`.
- Review: `review`.
- Make PR: terminal no-change result or `pullRequest`.
- Sync Tracker State: tracker synchronization result.

Alternative considered: keep cumulative snapshots but prune only obviously duplicated fields. That still leaves ambiguous ownership and keeps making later stage schemas larger than the data they produce.

### 3. Remove `nextInput` from handoff records

`appendHandoffRecord` should still return the appended record's `inputRecordRef`. Flow units should use that return value to create the next BullMQ payload with `createForwardStagePayload`. The persisted handoff record does not need to store a copy of that payload.

The handoff record already has the durable transition metadata needed for diagnostics: `recordId`, `sequence`, `runId`, `fromStage`, `toStage`, attempts, status, and dependency record ids. The actual queued payload is transport state and should not be treated as stage output.

Alternative considered: keep `nextInput` as a convenience for replay. That convenience is weak because the real payload can differ from persisted `nextInput` fields such as `taskId`, and replay still needs queue-specific scheduling behavior.

### 4. Replace single dependency with explicit dependency record ids

Change `dependsOn` from `HandoffRecordDependency | null` to an explicit list of prior record ids:

```ts
type HandoffRecordDependency = string;
dependsOn: HandoffRecordDependency[];
```

The list records the `recordId` values for handoff records needed to understand or continue from the current output. It is empty for the first Prepare Run record. It can contain more than one prior record when a stage requires multiple stage outputs.

Examples:

- Assess record depends on the Prepare Run handoff record or can use an empty list if all required context is in `run.json`; this should be finalized in specs.
- Plan record depends on the Assess record.
- Develop record depends on the accepted Plan record.
- Review record depends on the Develop record and the accepted Plan record.
- Make PR record depends on the Review record and any development/quality record it needs to validate reviewed work.
- Sync Tracker State record depends on the Make PR record.

This is metadata-only duplication: record ids are copied, not stage outputs. The benefit is that later stages can load exact records by id instead of walking every JSONL line and inferring the latest relevant result.

Alternative considered: keep a linear `dependsOn` and make each resolver traverse backwards until it finds all required stages. That is simple initially, but it recreates hidden coupling and makes stage input requirements less visible.

### 5. Add stage-specific context resolvers

Introduce shared helpers that validate a queue payload, read the direct input record, read `run.json`, and load only the dependency records required by the receiving stage. The helpers should return typed context objects rather than raw merged JSON.

Example contexts:

```ts
DevelopContext = {
  runContext: StableRunContext;
  plan: PlanOutput;
}

ReviewContext = {
  runContext: StableRunContext;
  plan: PlanOutput;
  development: DevelopOutput['development'];
  quality: DevelopOutput['quality'];
}
```

Resolvers should fail when a required dependency record id is missing, points to the wrong stage, or has output that does not match the stage output schema. They should not silently scan the full ledger as a fallback, because that would hide broken dependency metadata.

Alternative considered: build one generic "full context" object for every stage. That would be easy to consume but would preserve the same over-broad context behavior this change is meant to remove.

## Risks / Trade-offs

- [Risk] Existing in-flight jobs may reference records written with the old cumulative contract. -> Mitigation: deploy with a queue drain or implement a short-lived compatibility reader if draining is not acceptable.
- [Risk] Moving stable context into mutable `run.json` could allow accidental changes to branch or workspace identity. -> Mitigation: treat `stableContext` fields as write-once after initialization/preparation and validate attempted updates.
- [Risk] Dependency references can become incomplete if a stage forgets to list context required downstream. -> Mitigation: encode required dependencies in stage-specific tests and context resolver validation.
- [Risk] Reading selected records by dependency id still requires loading the JSONL file unless an index is added. -> Mitigation: keep the first implementation simple with bounded per-run JSONL reads; add an in-memory record map during resolution if needed.
- [Risk] Stage-local outputs make single JSONL lines less self-contained for manual debugging. -> Mitigation: `run.json` points to the ledger and latest record, while dependency ids make the minimal required context explicit.

## Migration Plan

1. Update OpenSpec requirements for run handoff ledger, orchestration infrastructure, pipeline behavior, and each affected stage.
2. Add failing tests for the new handoff record shape: no `nextInput`, array dependencies, and stage-local `output`.
3. Add stable run context to `RunSummaryData` and update Prepare Run to initialize it without duplicating full context into handoff outputs.
4. Update output schemas so Assess, Plan, Develop, Review, Make PR, and Sync Tracker State validate only stage-local output.
5. Implement stage-specific context resolvers and update job modules to consume typed contexts.
6. Update handoff append validation, run summary updates, and queue scheduling tests.
7. Run focused job tests, then full test and lint commands.

Rollback before deployment is a normal code revert. Rollback after deployment requires either draining jobs created under the new contract or temporarily supporting both old and new handoff record shapes.

## Open Questions

- Should the first Assess record explicitly depend on Prepare Run, or should Prepare Run's stage-local record be diagnostic-only once stable context is in `run.json`?
- Should `stableContext` be a nested object in `run.json` or top-level fields on `RunSummaryData`?
- Should dependency ids eventually include a semantic role elsewhere, or are `recordId` strings plus resolved record validation sufficient for diagnostics?
