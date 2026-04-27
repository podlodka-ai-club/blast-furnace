## Context
The current pipeline is implemented as BullMQ job handlers. Several handlers perform useful work and then enqueue the next job directly. For example, the Plan job logs planning state and enqueues Codex, while Codex performs development work and enqueues Review with the temporary repository path. This behavior is correct for the current system and must not change in this proposal.

The product direction requires durable file-backed handoffs under `.orchestrator/runs/<runId>/`, immutable stage attempts, immutable decision records, and a mutable `run.json` summary. Those future artifact sets should be designed per job in separate changes. This change only prepares the code structure and generic infrastructure needed to add them safely.

## Goals / Non-Goals
- Goal: Establish a shared orchestration toolkit for run paths, append-only writes, generic artifact/event metadata, and `run.json` summary updates.
- Goal: Establish shared next-job scheduling mechanics that job-local flow units use after choosing the next transition.
- Goal: Split current pipeline jobs into `flow` and `work` units without changing observable behavior.
- Goal: Keep each job's flow local to that job so parallel development remains practical.
- Non-goal: Define the concrete artifact files produced by Plan, Develop, Review, Make PR, or Check PR.
- Non-goal: Change BullMQ payloads to artifact references.
- Non-goal: Add rework behavior, artifact selection, schema validation, or new pipeline stages.

## Design
Each existing pipeline job module should be reorganized around two units:

- `work`: executes the useful operation for that job and returns a typed result.
- `flow`: receives the BullMQ job, validates the incoming payload as needed, calls `work`, performs any existing side effects around progress/logging/cleanup, chooses the same downstream transition as today, and uses shared orchestration infrastructure to schedule that downstream job with the same data as today.

The public handler exported to the worker remains stable. Worker routing continues to call the same job handler names, and tests should prove that existing downstream enqueue behavior and cleanup behavior are unchanged.

A shared orchestration toolkit should provide common filesystem primitives for future handoffs:

- create or resolve `.orchestrator/runs/<runId>/`
- resolve attempt-scoped stage directories
- write append-only files and fail if the target exists
- update the only mutable run summary file, `run.json`
- construct generic artifact and event metadata records
- schedule the next BullMQ job from a flow-owned transition decision without changing job names or payload data

The toolkit should be used by job-local flow units for common mechanics, including downstream scheduling. The decision about which job comes next remains local to the flow unit in this proposal. This change does not require every job to start producing domain artifacts. If any infrastructure smoke artifact is needed for tests, it should be generic and must not become the job-specific handoff contract.

## Rationale
A single central coordinator would concentrate transition logic in one shared module and make parallel job development harder. Keeping flow logic inside each job preserves local ownership. The shared toolkit prevents each job from inventing incompatible path, attempt, and append-only conventions.

This produces a federated orchestration model: jobs own their own flow decisions, while common infrastructure owns the mechanics that must be consistent across all jobs.

## Compatibility
This change is intentionally behavior-preserving. Existing job names, queue routing, job payload shapes, GitHub operations, temporary repository lifecycle, commit/push/PR behavior, label transitions, and cleanup semantics must remain unchanged.

Future changes can use the prepared infrastructure to introduce concrete artifacts and artifact references incrementally, one job boundary at a time.
