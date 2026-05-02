## Context

The current pipeline is linear: Intake creates a run, Prepare Run creates the issue branch and workspace, downstream stages operate in that workspace, Make PR creates the pull request, and Sync Tracker State performs tracker side effects plus workspace cleanup. After that point there is no active stage watching the pull request for human review outcomes.

Rework changes this from a one-shot flow into a post-PR lifecycle. The system must keep the workspace cleanup behavior after PR publication, but it must also continue monitoring the pull request until the PR is merged, closed without merge, or a human-triggered rework is required. Rework must resume in a fresh workspace from the existing PR branch and route through Plan or Develop based on Codex analysis of human comments.

The main constraints are the existing JSONL handoff ledger model, transport-only queue payloads, run summary pointer index, and stage-local ownership. Business data should continue to flow through handoff records and dependencies rather than queue payload fields.

## Goals / Non-Goals

**Goals:**

- Add PR Rework Intake as a new post-PR polling stage that owns PR merge detection, closed-without-merge detection, rework trigger detection, and rework route analysis.
- Keep Sync Tracker State focused on external tracker side effects and workspace cleanup.
- Reuse Prepare Run as the workspace preparation boundary for rework instead of letting PR Rework Intake clone repositories.
- Preserve the ledger-first handoff model for all new transitions.
- Support rework routing to Plan or directly to Develop while resolving the latest available accepted plan deterministically.
- Ensure every rework still passes through Quality Gate, Review, Make PR, and Sync Tracker State.

**Non-Goals:**

- Do not introduce webhooks; polling remains the trigger mechanism.
- Do not keep target repository workspaces alive while waiting for human review.
- Do not make Sync Tracker State responsible for rework polling, comment collection, or route analysis.
- Do not pass PR comments, plan content, workspace paths, or route decisions through queue payload business fields.

## Decisions

### PR Rework Intake is a per-run polling loop

PR Rework Intake will be scheduled after Sync Tracker State completes post-PR synchronization and cleanup. It receives the current run id and a handoff reference to the Sync Tracker State output, then reads the run summary and handoff ledger to resolve the pull request record, source issue, repository identity, prior PR Rework Intake handoffs, and current `reworkAttempt`.

This avoids a global PR-to-run lookup problem. A global scanner would need a separate durable index from pull requests back to run ledgers and would have to handle ambiguous PRs after restarts. A per-run polling job already has the run identity and can poll the specific PR it owns.

If the PR is open and neither merge nor `Rework` is present, PR Rework Intake re-enqueues itself after the same interval used by Intake and does not append a new handoff record. It appends a handoff only when the run reaches a terminal merged outcome, a terminal closed-without-merge outcome, a terminal too-many-reworks outcome, a no-comment trigger outcome, or a real rework handoff.

### PR Rework Intake uses per-run concurrency control

PR Rework Intake must tolerate duplicate delayed jobs, BullMQ retries, and process crashes. Before processing a non-idle outcome, it acquires a per-run lock or writes a durable in-progress marker in the run summary. The marker identifies the PR Rework Intake action being processed, such as merged closure, closed-without-merge closure, no-comment trigger consumption, too-many-reworks termination, or rework handoff creation.

If another PR Rework Intake job finds an active marker for the same run, it exits without appending a handoff or scheduling more work. If it finds an already-appended handoff for the same trigger/action, it treats the operation as complete and only recovers the missing next enqueue when needed.

Handoff append and next-job enqueue are designed as an idempotent two-step transition. The handoff record is the durable decision. After appending, the run summary records the pending next stage and handoff reference before enqueueing the job. On retry or restart, PR Rework Intake checks the ledger and run summary first: if the handoff exists but the next job may not have been enqueued, it re-enqueues the same next stage from the same handoff reference rather than appending a duplicate record.

### PR Rework Intake owns trigger interpretation, not workspace preparation

When `Rework` is present, PR Rework Intake validates the attempt limit, collects qualifying comments, renders the review-comments analysis prompt, runs Codex, decides the route, and appends a `pr-rework-intake` handoff with:

- pull request identity and head branch/ref
- comments markdown
- full Codex route-analysis response
- selected next stage, `plan` or `develop`
- latest available accepted Plan record id
- previous rework trigger record id when available

It then enqueues Prepare Run with a transport-only payload referencing that handoff. The queued payload uses incremented `reworkAttempt` and `stageAttempt: 1`.

The alternative was to let PR Rework Intake clone the repository and enqueue Plan or Develop directly. That would blur the stage boundary and duplicate Prepare Run logic. Delegating to Prepare Run keeps all workspace creation and branch checkout behavior in one module.

Qualifying comments exclude comments authored by Blast Furnace, comments whose GitHub user type is `Bot`, outdated review comments, resolved review comments, and deleted comments. PR-level comments and review comments may have different metadata, so the collector should normalize only active comments that remain visible and actionable.

### Prepare Run supports initial mode and rework mode

Prepare Run keeps its existing initial-run behavior when invoked by Intake: initialize run files, create or reuse the issue branch, clone the workspace, append the first handoff with `dependsOn: []`, and enqueue Assess.

When invoked from PR Rework Intake, Prepare Run runs in rework mode. It reads the input handoff, clones the configured repository into a fresh workspace, checks out and resets to the PR head branch, updates the run summary's current workspace pointer, and appends a Prepare Run handoff that depends on the PR Rework Intake handoff. Its `toStage` is the selected route from the PR Rework Intake handoff, not Assess.

This requires changing the current ledger rule that only Prepare Run can be the first handoff and always hands off to Assess. That remains true only for initial runs. In rework mode, Prepare Run is a later handoff and must preserve the PR Rework Intake dependency chain.

### Workspace path is current prepared workspace state

The issue identity, repository identity, and branch identity remain stable for the run. The workspace path is different: after Sync Tracker State cleanup, the previous workspace no longer exists. During rework, Prepare Run replaces the current workspace pointer with the newly prepared workspace path.

Downstream stages continue to read the workspace path from the run summary. The only stage allowed to replace that pointer is Prepare Run, and only after successfully preparing a workspace. Sync Tracker State remains the stage that deletes the workspace after PR creation or rework finalization.

### Plan selection uses the latest accepted Plan dependency

PR Rework Intake resolves the latest available accepted Plan record before creating a rework handoff. The first rework uses the original accepted Plan. Later reworks use the most recent accepted Plan produced by a prior rework routed through Plan. If all prior reworks went directly to Develop, the original accepted Plan remains the latest available plan.

The selected Plan record id is stored as an explicit dependency or dependency reference in the PR Rework Intake handoff so Plan, Develop, Review, and Make PR can resolve context without scanning loosely related ledger records.

### Rework Plan and direct Develop consume Prepare Run handoffs

Plan rework receives a Prepare Run handoff whose dependency chain includes PR Rework Intake and the latest accepted Plan. Plan renders `prompts/plan-rework.md` with task title, task description, latest plan content, and comments markdown. A successful rework Plan appends a normal accepted Plan handoff and enqueues Develop.

Direct Develop rework receives a Prepare Run handoff whose dependency chain includes PR Rework Intake and the latest accepted Plan. Develop treats this as a new supported input type, resolves the comments markdown as `reviewContent`, resolves the latest plan content, renders `prompts/develop-rework.md`, and then continues through Quality Gate and Review.

This is intentionally different from existing Review-triggered rework, where Develop consumes a failed Review handoff. Both paths remain valid and are distinguished by the input handoff's producing stage and dependencies.

### Make PR updates an existing PR during rework

Make PR keeps creating a new pull request for the initial run. For rework runs, it reads the PR identity and branch context from the dependency chain, commits and pushes to the existing PR branch, and appends a pull-request finalization handoff for Sync Tracker State.

If a rework produces no repository changes, Make PR still hands off to Sync Tracker State instead of ending terminally inside Make PR. Sync Tracker State must remove the `Rework` label, move the source issue back to `in review`, and clean up the workspace even when there was no commit.

Before pushing rework changes, Make PR verifies that the current pull request head still belongs to the configured owner and repository, that the head branch matches the branch stored in the rework handoff chain, and that the remote head SHA matches the expected head SHA captured when PR Rework Intake initiated the rework or Prepare Run checked out the branch. Fork pull requests, unexpected head repositories, unexpected branch names, and unexpected head SHAs are rejected before commit or push side effects.

For non-fast-forward push conflicts, Make PR refetches the PR branch, verifies the PR identity and expected branch again, rebases or resets according to the existing repository finalization policy, and retries push with the same bounded retry budget used for normal pushes. If the branch still cannot be updated safely after the retry budget is exhausted, Make PR fails without removing the `Rework` label or moving tracker state.

### Sync Tracker State remains the external side-effect and cleanup stage

Sync Tracker State continues to own issue tracker transitions, pull request label cleanup, and workspace deletion. After initial PR creation or rework finalization, it appends tracker-sync output and enqueues PR Rework Intake rather than marking the run complete.

Sync Tracker State does not inspect review comments, monitor merge or closed-without-merge state, decide rework routes, or close runs. PR Rework Intake owns those post-PR lifecycle decisions.

## Risks / Trade-offs

- [Long-lived polling jobs can accumulate] -> Keep PR Rework Intake repeat scheduling per run and append no ledger records during idle polls. Job retention remains managed by BullMQ.
- [Run summary workspace path is no longer immutable] -> Limit updates to Prepare Run after successful workspace preparation and document that the field represents the current prepared workspace.
- [Route analysis Codex failures could block review] -> Treat failed, timed-out, or malformed route analysis as a Plan route unless the failure prevents producing a handoff at all; specs should define the exact terminal/retry behavior.
- [Repeated `Rework` labels can retrigger the same comments] -> Remove the `Rework` label on no-comment outcomes and after Sync Tracker State completes rework finalization. Use the previous PR Rework Intake handoff `createdAt` as the lower bound for later comment collection.
- [Direct Develop rework adds a new input shape] -> Add explicit validation for Prepare Run handoffs that depend on PR Rework Intake and a latest accepted Plan record, rather than loosening Develop validation generally.
- [PR Rework Intake needs PR identity after restarts] -> Keep pull request identity in the Make PR output and preserve latest relevant handoff references in the run summary so the per-run poller can recover from persisted ledger state.
- [Duplicate delayed jobs could schedule duplicate reworks] -> Use a per-run lock or durable in-progress marker and make handoff append plus enqueue recoverable from the ledger and run summary.
- [Human or external pushes can move the PR branch during rework] -> Verify PR head repository, branch, and expected SHA before push, reject unsafe targets, and use a bounded refetch/retry policy for non-fast-forward conflicts.

## Migration Plan

1. Add `pr-rework-intake` to workflow stage types, worker routing, queue payload validation, and run status handling.
2. Extend Make PR and Sync Tracker State handoffs so the pull request identity and PR branch can be recovered by PR Rework Intake.
3. Add PR Rework Intake as a repeatable/delayed per-run polling stage started by Sync Tracker State after post-PR synchronization, including per-run concurrency control and enqueue recovery.
4. Extend Prepare Run with rework mode while preserving current initial-run behavior.
5. Add Plan and Develop rework prompt rendering and input validation.
6. Update Make PR rework finalization with existing-PR branch safety checks and non-fast-forward retry handling, then update Sync Tracker State rework cleanup side effects.

Rollback is to stop scheduling PR Rework Intake after Sync Tracker State. Existing initial-run behavior remains compatible as long as Prepare Run's initial mode and Make PR's initial PR creation path are preserved.

## Open Questions

- Should PR Rework Intake store idle poll timestamps in the run summary for operator diagnostics, or only log them?
- Should a route-analysis Codex process failure retry the PR Rework Intake job through BullMQ, immediately route to Plan, or append a terminal blocked handoff?
