# Change: Add job flow/work orchestration infrastructure

## Why
The pipeline is moving toward durable artifact handoffs and explicit orchestration decisions, but the current job modules mix useful work, flow control, and downstream scheduling in one handler. This makes future artifact transfer and rework semantics harder to add atomically.

## What Changes
- Introduce shared orchestration infrastructure for run-scoped files, append-only artifact/event writing, run summary updates, and common stage attempt metadata.
- Split existing pipeline job modules into `flow` and `work` units, where `flow` owns validation, persistence, and scheduling while `work` owns the stage-specific useful operation.
- Preserve the existing job business logic, GitHub interactions, queue routing, downstream scheduling decisions, and BullMQ payload data transfer exactly as they behave today.
- Defer job-specific artifact sets, artifact schemas, and artifact references in queue payloads to later changes.

## Impact
- Affected specs: `job-orchestration-infrastructure`
- Related specs: `job-queue`, `issue-processing`, `plan-job`, `review-job`, `make-pr-job`, `check-pr-job`
- Affected code: `src/jobs/*`, `src/types/index.ts`, new shared orchestration utilities under `src/jobs/` or `src/orchestrator/`
