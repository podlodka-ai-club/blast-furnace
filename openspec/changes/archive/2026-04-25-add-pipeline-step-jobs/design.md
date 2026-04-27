## Context
Blast Furnace currently receives GitHub issues through intake jobs, performs assessment work in `issue-processor`, then schedules `codex-provider` for development. The project direction calls for an explicit pipeline of `Intake -> Assess -> Plan -> Develop -> Review -> Make PR`, with each step in its own job and module.

## Goals / Non-Goals
- Goals: add explicit Plan, Review, and Make PR job boundaries; keep each step in an isolated module; preserve existing payload data across the new handoffs.
- Goals: update existing jobs so every implemented step schedules the next requested step in the pipeline.
- Goals: move deterministic commit, push, pull request creation, and label transition into Make PR ownership.
- Non-Goals: define final planning or review behavior beyond initial pass-through handoffs.
- Non-Goals: introduce durable handoff artifacts, quality gates, review loops, or new external dependencies.

## Decisions
- Decision: use BullMQ job names `plan`, `review`, and `make-pr` to match the requested pipeline step names and existing kebab-case job naming style.
- Decision: keep each new step in its own `src/jobs/<step>.ts` module with a focused handler and tests.
- Decision: preserve issue and branch data passed between jobs. The scheduled job envelope may use a new job type and task id so the worker can route it, and later handoffs may add deterministic execution context such as the temporary repository path.
- Decision: treat `make-pr` as the terminal step for this change and make it the owner of deterministic repository finalization: detecting changes, committing, pushing, opening the pull request, and transitioning labels.
- Decision: `codex-provider` SHALL only own development execution and its required development workspace. It SHALL schedule `review` after successful Codex execution, pass the temporary repository path for finalization, and SHALL NOT commit, push, open pull requests, or transition issue labels.

## Risks / Trade-offs
- Moving finalization out of `codex-provider` requires the implementation to hand off the temporary repository path and defer successful-workspace cleanup to Make PR.
- Adding pass-through jobs increases queue hops and latency, but the isolation supports independent future development of each pipeline step.

## Migration Plan
1. Add shared payload types for `plan`, `review`, and `make-pr`.
2. Add worker routing for the new job types.
3. Change `issue-processor` to enqueue `plan` instead of `codex-provider`.
4. Add the Plan module to enqueue `codex-provider`.
5. Change `codex-provider` to enqueue `review` after successful development processing and remove commit, push, pull request, and label transition behavior from it.
6. Add the Review module to enqueue `make-pr`.
7. Add the Make PR module as the terminal receiver, move deterministic repository finalization behavior into it, and clean up the handed-off temporary repository when finalization completes or fails.
8. Cover routing, handoff, and finalization ownership with focused tests, then run the standard validation commands.
