## Context

The status comment is currently represented by `RunStatusMetadata.checklist`, where each item has a `stage`, `attempt`, state, label, and optional detail. Item ids are based on `stage:attempt-N`, and rendering derives the main progress table plus a compact review feedback loop from those items.

Human PR rework now enters the workflow through `pr-rework-intake`, then `prepare-run`, then either `plan` or `develop`. The domain `stageAttempt` is reset to `1` when entering rework, so `stageAttempt` alone cannot distinguish `plan:attempt-1` in the original run from `plan:attempt-1` in rework 1 or rework 2. Status state needs an explicit rework scope.

## Goals / Non-Goals

**Goals:**

- Keep a single orchestrator status comment for the whole run.
- Render each human rework as its own subsection in that status comment.
- Make rework status rows idempotent and unambiguous even when `stageAttempt` resets.
- Show the initial human review trigger row before downstream rework routing has fully resolved.
- Mark `Plan` as skipped when a rework routes directly to `Develop`.

**Non-Goals:**

- Do not introduce a new GitHub comment kind for rework status.
- Do not change the handoff ledger meaning of `stageAttempt` or `reworkAttempt`.
- Do not redesign PR comment collection or route analysis.

## Decisions

### Add rework scope to status checklist items

Extend `StatusChecklistItem` with an optional `reworkAttempt` field. Initial-run rows either omit it or use `0`; rework rows use the domain `reworkAttempt` from the queue payload and handoff context. Keep `attempt` as the per-stage attempt number so existing stage retry semantics remain intact.

Stable status ids should include the rework scope for rework rows, for example:

- Initial run: `plan:attempt-1`
- Rework 1: `rework-1:plan:attempt-1`
- Rework 2: `rework-2:plan:attempt-1`

This avoids collisions after `stageAttempt` resets and preserves idempotent upsert behavior. The alternative was to overload `attempt` with a globally increasing visible attempt number, but that would blur two separate concepts: the workflow's domain attempt counters and the presentation grouping needed by the status comment.

### Treat status stages as presentation row kinds

`StatusItemStage` is a tracker status row taxonomy, not the workflow stage enum. It already includes workflow-adjacent and aggregate rows such as `task-pickup`, `quality-gate`, `draft-pr-and-in-review`, and `review-feedback-loop`. Add `human-review` as a normal presentation row kind for the rework trigger row.

PR Rework Intake initializes the rework group with a constant row:

`🟡 | Human Review | Rework needed |`

This row should be stable for the rework attempt, for example `rework-1:human-review:attempt-1`. It is not a queue stage and should not affect workflow scheduling.

### Initialize all possible rework rows at trigger time

When PR Rework Intake accepts a rework trigger with qualifying comments, it updates the existing status comment before enqueueing Prepare Run. It appends or upserts a rework group containing:

- Human Review: `retrying` or equivalent yellow state with detail `Rework needed`
- Prepare Run: pending or in progress, depending on exact update point
- Plan: pending
- Develop: pending
- Quality Gate: pending
- Code Review: pending
- Make PR: pending

Including `Plan` from the start is deliberate because route analysis can choose either `plan` or `develop`, and stakeholders should see the full possible rework path immediately.

### Mark Plan skipped for direct Develop rework

When Prepare Run determines that the rework route is directly to `develop`, it must upsert the scoped Plan row as `skipped` with detail `skipped`. The id must include the same `reworkAttempt`, for example `rework-1:plan:attempt-1`, so it updates the rework table rather than the original Plan row.

If route analysis sends the rework to `plan`, Plan transitions normally through `in-progress` and `completed`. Develop and later rows then use the same rework scope.

### Render rework groups from scoped checklist state

Rendering should keep the existing main progress table for the original flow. Rework rows should be grouped by `reworkAttempt > 0` and rendered as separate subsections, ordered by rework attempt. Each subsection should explain that human review comments were left and the work is being redone, then render a normal three-column table using the existing icon mapping.

The existing review feedback loop summary can be replaced or narrowed once scoped rework tables exist. Keeping both would duplicate the same information. If backward compatibility with already persisted unscoped attempt rows matters, the renderer can continue to support the old compact loop for rows with `attempt > 1` and no `reworkAttempt`.

## Risks / Trade-offs

- [Risk] Existing persisted status metadata has no `reworkAttempt` field. → Mitigation: treat missing `reworkAttempt` as initial-run scope and keep current ids valid.
- [Risk] Future code may treat `StatusItemStage` as equivalent to `WorkflowStage`. → Mitigation: document status stages as tracker presentation row kinds, keep queue and handoff routing on `WorkflowStage`, and do not derive workflow routing from status checklist rows.
- [Risk] Rework status updates may race with worker retries. → Mitigation: keep all rows keyed by stable scoped ids and continue using replace-by-id upserts.
- [Risk] Rendering old unscoped rework rows and new scoped groups together could duplicate information. → Mitigation: prefer scoped groups when present and only render the legacy feedback loop for legacy unscoped rows.
