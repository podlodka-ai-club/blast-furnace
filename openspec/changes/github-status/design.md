## Context

Blast Furnace already runs work as a queue-driven stage flow with run-scoped JSON files under `.orchestrator/runs/<timestamp>_<runId>/`. Stable run context lives in the mutable run summary, and stage outputs are appended to the JSONL handoff ledger. GitHub integration is currently a collection of configured-repository helpers for issues, branches, labels, and pull requests.

Status reporting is a cross-cutting orchestration concern: the initial status comment is created when intake accepts a task, and later stages must update the same external status as the run moves through Prepare Run, Assess, Plan, Develop, Quality Gate, Review, and the combined Draft PR / move issue to `in review` step. Review can also branch back to Develop for rework, so the visible checklist cannot be a static one-time list.

The design must keep GitHub replaceable. Stage flow code should depend on a tracker client interface that can cover status updates, future comments, and tracker state transitions, while GitHub-specific code remains an implementation detail.

## Goals / Non-Goals

**Goals:**
- Provide a flat tracker client interface that supports creating and updating an external status view now and can later support other tracker operations.
- Implement a GitHub-backed tracker client that creates or updates a single issue comment for the run status.
- Persist status identity and checklist state in run-scoped orchestration state so every update targets the same status comment.
- Render a full checklist from task pickup through Draft PR creation and issue transition to `in review`, with task pickup already checked in the initial comment.
- Expand the checklist when Review routes back to Develop for rework, preserving completed history and adding the rework Develop, Quality Gate, Review path plus the combined Draft PR / move issue to `in review` step.
- Keep future tracker comments distinguishable from the status comment.

**Non-Goals:**
- Implementing plan comments, rework-start comments, or tracker transitions beyond the status comment operations in this change.
- Replacing the existing queue, handoff ledger, or run summary architecture.
- Reporting live subprocess output, detailed logs, or quality gate output in the GitHub status comment.
- Creating a generic notification system beyond the tracker client operations needed by this change.

## Decisions

### Use a Flat Tracker Client Interface

Add a shared tracker boundary, for example `TrackerClient`, with flat methods that express orchestration intent rather than GitHub operations:

- `createOrUpdateStatusComment(input)` creates or locates the external status view and records the initial or updated checklist.
- Future methods can be added alongside it, for example `createPlanComment(input)`, `createReworkStartComment(input)`, and `transitionTaskState(input)`.

The interface should accept domain-level state such as run id, issue identity, repository identity, comment kind, checklist items, and current summary text. It should not expose GitHub comment ids as mandatory inputs to stage flow code.

Rationale: flow units should not know whether tracker operations are backed by GitHub comments, another tracker, or a no-op implementation in tests. A flat interface keeps the first implementation simple while leaving a single replacement boundary for future tracker work.

Alternative considered: call GitHub comment helpers directly from each job. Rejected because it spreads GitHub-specific behavior through stage code and makes later replacement difficult.

### Persist Status State in the Run Summary

Extend run summary data with a status section that stores:

- provider name, initially `github`.
- status kind, initially `orchestrator-status`.
- external identity, for GitHub the issue comment id or node id.
- last rendered checklist state.
- timestamps for creation and last update when available.

The handoff ledger remains the source of formal stage outputs. The run summary stores mutable status identity and the current rendered state because status updates are intentionally mutable and provider-facing.

Status initialization requires an existing run summary. Intake should create the run file set and initialize the run summary before calling the tracker client to create the initial status comment. Prepare Run then consumes the already-initialized run context and continues repository preparation rather than being the first owner of run summary creation. This keeps status identity in the same durable run-scoped state from the first external side effect and avoids a temporary Redis-only status identity that would need to be transferred later.

Rationale: the run summary is already the mutable run-scoped state file and is available to every stage through existing orchestration helpers.

Alternatives considered:
- Store status identity only in the GitHub comment marker and rediscover it for every update. Rejected because repeated list-and-search calls increase GitHub dependency and make recovery ambiguous if comments are edited.
- Persist pre-Prepare status identity in Redis and transfer it into the run summary during Prepare Run. Rejected because it creates a second lifecycle for durable run metadata and adds recovery cases if Prepare Run starts after the status comment is created but before the transfer succeeds.

### Identify the Correct GitHub Comment with a Hidden Marker

The GitHub status comment body must include exactly one stable hidden marker with parseable fields:

`<!-- blast-furnace:tracker-comment kind=orchestrator-status runId=<runId> owner=<owner> repo=<repo> issue=<number> -->`

The GitHub tracker client should use both persisted comment id and the marker:

- If run summary contains a comment id, update that comment.
- If updating by id returns a not-found result, list issue comments and find the marker for `kind=orchestrator-status`, the same `runId`, configured `owner`, configured `repo`, and issue number.
- If no matching marker exists, create a new status comment with the marker and persist the new id.
- If the persisted comment exists but its marker is missing, mismatched, or has a different kind/run/repository/issue, treat the comment as invalid for status updates, search by marker, and create a replacement only when no valid marker match exists.
- If multiple comments have matching valid markers, update the newest matching comment, persist its id, and leave older duplicates unchanged.
- If a user edits visible comment content but leaves the marker intact, replace the body with the freshly rendered status body and the same marker.
- If GitHub returns permission, validation, abuse/rate-limit, or other non-404 errors, do not search-and-recreate; surface the provider failure to the caller for logging and retry policy.

Future tracker comments must use different comment kinds in their marker, for example `orchestrator-plan` or `orchestrator-rework-start`, so the tracker client never confuses a plan or rework-start comment with the status comment.

Rationale: persisted identity gives efficient normal updates, while the marker gives recovery and disambiguation.

Alternative considered: identify the comment by visible title text. Rejected because titles can collide and users may edit visible comment text.

### Model Status as an Ordered Checklist

Represent status as ordered items with stable ids and display labels. Each item id must be deterministic and attempt-aware. Base-flow ids should use attempt suffixes, for example:

- `task-pickup:attempt-1`
- `prepare-run:attempt-1`
- `assess:attempt-1`
- `plan:attempt-1`
- `develop:attempt-1`
- `quality-gate:attempt-1`
- `review:attempt-1`
- `draft-pr-and-in-review:attempt-1`

The initial comment is created when intake claims an eligible issue and enqueues Prepare Run, so `task-pickup` is immediately marked completed. Prepare Run is the first incomplete or active downstream step in the initial view.

Checklist item states are:

- `pending`: known future work that has not started.
- `in-progress`: the current active item for the running stage or deterministic quality gate.
- `completed`: the item finished successfully, or the stage made a non-terminal routing decision that is complete from that item's perspective.
- `retrying`: the item attempt failed validation or review but the workflow remains active and another attempt/rework item exists.
- `blocked`: the workflow cannot continue without intervention, but this is not represented as a provider failure.
- `failed`: the workflow has terminally failed at this item.
- `skipped`: the item will not run because an earlier terminal or no-change outcome ended the visible flow.

Completed items render checked. All other states render unchecked with visible status text. `failed` always means terminal workflow failure for the visible flow. Attempt-level failures that still allow continuation render as `retrying`, not `failed`.

Stage output mappings:

- Intake claim succeeds -> `task-pickup:attempt-1` is `completed`.
- Prepare Run starts -> `prepare-run:attempt-1` is `in-progress`; successful handoff to Assess -> `completed`; preparation failure -> `failed`.
- Assess starts -> `assess:attempt-1` is `in-progress`; successful handoff to Plan -> `completed`; terminal rejection/blocking outcome -> `blocked` or `failed` according to the Assess output status.
- Plan starts -> `plan:attempt-1` is `in-progress`; validation failure with remaining attempts -> `retrying`; accepted plan handoff to Develop -> `completed`; validation exhaustion -> `blocked`.
- Develop starts -> the matching `develop:attempt-N` is `in-progress`; successful development with passed quality result -> `completed`; terminal quality failure/misconfiguration/timeout -> `failed`.
- Quality Gate starts or is evaluated from the Develop quality result -> the matching `quality-gate:attempt-N` is `in-progress`; `quality.status: "passed"` -> `completed`; `quality.status: "failed"`, `"timed-out"`, or `"misconfigured"` when Develop terminates -> `failed`.
- Review starts -> the matching `review:attempt-N` is `in-progress`; Review success and handoff to Make PR -> `completed`; Review failed with retry budget remaining -> `retrying`; Review malformed or exhausted terminal output -> `failed`.
- Combined Draft PR / move issue to `in review` starts -> `draft-pr-and-in-review:attempt-1` is `in-progress`; pull request created -> `completed`; no-change terminal outcome -> `skipped` or `completed` with a visible no-change result; git, push, or pull request creation failure before a PR exists -> `failed`; issue transition failure after PR creation -> keep the item `completed` and include a visible warning/detail that the PR was created but moving the issue to `in review` failed.

Rationale: stable ids allow deterministic updates and tests, while display labels can evolve without changing status identity.

Alternative considered: derive the entire checklist from handoff records on every update. Rejected because the checklist contains projected future steps and Review-triggered rework expansion, not only completed stage outputs.

### Render Status as a GitHub Status Card

Render the GitHub status comment as a polished status card rather than a plain checkbox list. The visible comment must omit the issue number and run id because the comment already lives on the issue and the run id is an implementation detail. The hidden marker still carries run and repository identity for machine matching.

The rendered body should use this structure:

- hidden marker as the first line.
- one `#` heading with the current high-level outcome, for example `Blast Furnace is building a solution`, `Blast Furnace is applying review feedback`, `Blast Furnace stopped after review`, or `Blast Furnace created a pull request`.
- a two-column metadata table with `Взято в работу` and `Последнее изменение` timestamps.
- a short blockquote with the current focus, final state, or result.
- a `## Progress` table with status icon, stage label, and short status detail.
- when rework exists, a separate `### Review feedback loop` table instead of inserting every retry as peer rows in the main progress table.
- optional status note text for warnings such as tracker sync failure after PR creation.

The main progress table should use status icons instead of textual `completed` or `pending` suffixes:

- `✅` for completed items.
- `🔵` for the current in-progress item.
- `🟡` for retrying/rework-needed items.
- `⚪` for pending items.
- `❌` for terminal failures.
- `⏭️` for skipped items.
- `🔁` for the aggregate review feedback loop row.

The main flow remains visually stable:

|  | Stage | Status |
|---|---|---|
| ✅ | Task picked up | |
| ✅ | Prepare run | |
| ✅ | Assess issue | |
| ✅ | Plan solution | |
| 🔵 | Develop changes | In progress |
| ⚪ | Quality Gate | |
| ⚪ | Review | |
| ⚪ | Draft PR + move to `in review` | |

When Review requests rework, the main `Review` row should show the aggregate Review state and the rework details should move into a separate loop table. The loop table must include visual status icons in the Review column as well as Develop and Quality Gate columns, so a failed or change-requested Review is visible at a glance:

| Attempt | Develop | Quality Gate | Review |
|---|---|---|---|
| 1 | ✅ | ✅ | 🟡 Changes requested |
| 2 | 🔵 In progress | ⚪ | ⚪ |

For terminal review exhaustion:

| Attempt | Develop | Quality Gate | Review |
|---|---|---|---|
| 1 | ✅ | ✅ | 🟡 Changes requested |
| 2 | ✅ | ✅ | 🟡 Changes requested |
| 3 | ✅ | ✅ | ❌ Limit reached |

Rationale: GitHub comments are a user-facing part of the product experience. A compact status card is easier for investors and stakeholders to scan, while the tables preserve deterministic technical state for developers.

### Expand Rework Instead of Rewriting History

When Review emits `rework-needed` and routes to Develop, the status updater should:

- mark the current Review item as completed with a visible rework-needed result, or as a completed decision step depending on renderer wording.
- insert new items after that Review item for the rework Develop, rework Quality Gate, and subsequent Review.
- append the downstream combined Draft PR / move issue to `in review` step after the latest Review path.
- include attempt metadata in item labels or details, for example `Develop rework 1`, `Quality Gate rework 1`, and `Review rework 1`.

The original Develop, Quality Gate, and Review items remain in the checklist so the user can see why the run looped.

Rework expansion must upsert by deterministic item id instead of appending blindly. Rework ids should derive from the rework/stage attempt, for example `develop:attempt-2`, `quality-gate:attempt-2`, and `review:attempt-2`. If a status update is retried after a transient GitHub failure or worker retry, the existing items with those ids are updated in place and no duplicate checklist rows are created.

Rationale: users need an audit-friendly progress view, not a checklist that silently rewrites previous Review failure into a pending normal path.

Alternative considered: reuse the same Develop, Quality Gate, and Review checklist rows for every rework attempt. Rejected because it hides the number and cause of loops.

### Update Status from Flow Units at Transition Boundaries

Each flow unit should update status at meaningful orchestration boundaries:

- Intake initializes status after the processing claim succeeds and before or alongside enqueueing Prepare Run.
- Prepare Run marks preparation active/completed or failed around run setup and branch/workspace preparation.
- Assess marks assessment active/completed or failed.
- Plan marks planning active/completed, blocked on validation exhaustion, or failed.
- Develop marks initial or rework development active/completed and updates Quality Gate status from the deterministic quality result before handing off to Review or terminating on quality failure.
- Review marks review active/completed, expands rework when routing to Develop, marks terminal review failure states, or marks transition to Make PR.
- Make PR and tracker sync together drive the combined Draft PR / move issue to `in review` item: PR creation marks the item completed, successful tracker sync may add completion detail, and tracker sync failure after PR creation adds a warning without reverting the item to failed.

Status update failures should be logged and should not by themselves corrupt handoff records. Whether a status update failure fails the job should be limited to initialization: if the initial status comment cannot be created after task pickup, the issue has already been claimed, so the system should log the failure and continue rather than abandon the actual work.

Rationale: transition boundaries already know the next stage and outcome, and avoiding status failures as hard workflow failures prevents GitHub comment outages from blocking useful automation.

Alternative considered: a separate background reconciler updates status from the ledger. Rejected for the initial implementation because it adds another moving part and still needs mutable comment identity.

## Risks / Trade-offs

- GitHub comment update fails after work succeeds -> Log the error, preserve run summary state when possible, and allow the workflow to continue.
- User edits or deletes the status comment -> Persisted id plus hidden marker supports recovery when possible; if both are unavailable the reporter may recreate the status comment.
- Run summary write races between rapid updates -> Keep status updates in the same stage flow path as existing run summary writes and use the current read-modify-write pattern; add tests for preserving unrelated run summary fields.
- Checklist expansion becomes confusing after multiple rework attempts -> Use stable item ids with attempt numbers and append-only rework history.
- Future plan or rework-start comments collide with status comments -> Require comment kind in the hidden marker and in persisted status metadata.

## Migration Plan

- Add GitHub issue comment helpers and tests without changing stage behavior.
- Add the tracker client interface, Markdown renderer, run summary status metadata, and unit tests.
- Wire intake to create the initial status comment after task pickup, with `task-pickup` completed.
- Wire stage flow units to update status at transition boundaries.
- Add integration-style tests using fake reporters to verify update ordering and GitHub-specific tests for marker/comment id behavior.
- No data migration is required for existing completed runs; runs started before this change will not have status metadata.

Rollback is code rollback only. Status comments created by the feature can remain in GitHub; they are informational and are identified by their hidden marker.

## Resolved Decisions

- The user-facing checklist combines Draft PR creation and moving the issue to `in review` into one final visible item. The item is completed once the PR exists; a later failure to set `in review` is displayed as a warning because PR creation is the higher-value outcome.

## Open Questions

- Should status initialization failure be observable in metrics or only logs?
