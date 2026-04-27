## 1. Shared Infrastructure
- [x] 1.1 Write focused failing tests for shared orchestration types and path resolution for `.orchestrator/runs/<runId>/`, stage attempt directories, event paths, and `run.json`.
- [x] 1.2 Implement shared orchestration types for run IDs, stage names, attempt numbers, generic artifact metadata, event metadata, and run summary data.
- [x] 1.3 Implement filesystem helpers for resolving `.orchestrator/runs/<runId>/`, stage attempt directories, event paths, and `run.json`.
- [x] 1.4 Write focused failing tests for append-only artifact/event writes and mutable `run.json` updates.
- [x] 1.5 Implement append-only write helpers that fail when a target artifact or event path already exists.
- [x] 1.6 Implement `run.json` read/write helpers that treat `run.json` as the only mutable run file.
- [x] 1.7 Write focused failing tests for shared next-job scheduling infrastructure that preserves current BullMQ job names and payload data.
- [x] 1.8 Implement shared next-job scheduling helpers used by job flow units after the flow unit chooses the next transition.

## 2. Job Structure
- [x] 2.1 Write focused failing tests for `issue-processor` flow/work separation and unchanged Plan enqueue behavior.
- [x] 2.2 Split `issue-processor` into `flow` and `work` units while preserving branch creation and Plan enqueue behavior.
- [x] 2.3 Write focused failing tests for `plan` flow/work separation and unchanged Codex enqueue behavior.
- [x] 2.4 Split `plan` into `flow` and `work` units while preserving Codex enqueue behavior and payload forwarding.
- [x] 2.5 Write focused failing tests for `codex-provider` flow/work separation and unchanged Review enqueue and cleanup behavior.
- [x] 2.6 Split `codex-provider` into `flow` and `work` units while preserving clone, checkout, Codex execution, Review enqueue behavior, and cleanup semantics.
- [x] 2.7 Write focused failing tests for `review` flow/work separation and unchanged Make PR enqueue behavior.
- [x] 2.8 Split `review` into `flow` and `work` units while preserving Make PR enqueue behavior and payload forwarding.
- [x] 2.9 Write focused failing tests for `make-pr` flow/work separation and unchanged terminal, PR, label, Check PR enqueue, and cleanup behavior.
- [x] 2.10 Split `make-pr` into `flow` and `work` units while preserving no-change terminal behavior, commit, push, PR creation, label transition, Check PR enqueue behavior, and cleanup semantics.
- [x] 2.11 Write focused failing tests for `check-pr` flow/work separation and unchanged PR logging and temporary repository cleanup behavior.
- [x] 2.12 Split `check-pr` into `flow` and `work` units while preserving PR logging and temporary repository cleanup behavior.

## 3. Compatibility Verification
- [x] 3.1 Confirm the job tests prove each job enqueues the same downstream job with the same data as before.
- [x] 3.2 Confirm the job tests prove failure and cleanup behavior remains unchanged for Codex, Make PR, and Check PR.
- [x] 3.3 Run `npm test`.
- [x] 3.4 Run `npm run lint`.
- [x] 3.5 Run `npm run build`.
