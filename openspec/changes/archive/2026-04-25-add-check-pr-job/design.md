## Context
Blast Furnace currently uses the pipeline `issue-processor -> plan -> codex-provider -> review -> make-pr`. The `make-pr` stage both performs deterministic repository finalization and owns temporary working directory cleanup. The requested change adds a new `check-pr` stage after `make-pr` and moves cleanup into that new terminal job.

## Goals / Non-Goals
- Goals: add an explicit `check-pr` stage after `make-pr`.
- Goals: move successful-workspace and terminal cleanup ownership from `make-pr` to `check-pr`.
- Goals: preserve the existing deterministic responsibilities of `make-pr` for commit, push, pull request creation, and label transition.
- Non-Goals: add asynchronous GitHub polling, mergeability checks, CI status checks, or other remote PR inspection behavior.
- Non-Goals: change earlier pipeline stages or redefine Plan, Codex, or Review behavior.

## Decisions
- Decision: `check-pr` becomes the terminal pipeline step and the sole owner of cleanup for temporary repository paths that survive into post-development finalization.
- Decision: `make-pr` SHALL enqueue `check-pr` for both terminal outcomes it can determine deterministically:
  - when a pull request was created successfully
  - when no repository changes were produced and therefore no pull request exists
- Decision: the Make PR to Check PR handoff SHALL preserve the existing issue, branch, and temporary repository path, and MAY include pull request result metadata when a PR was created.
- Decision: `check-pr` SHALL remain minimal in this change. It exists to make post-PR handling explicit and to own terminal cleanup, not to introduce new network-driven PR verification logic.

## Risks / Trade-offs
- Adding another queue hop increases pipeline latency slightly, but it removes cleanup ownership from `make-pr` and leaves a clean extension point for later PR checks.
- The `check-pr` name is broader than the minimal initial behavior. Keeping the first version narrow avoids inventing unverifiable PR semantics during this proposal.

## Migration Plan
1. Add a shared `check-pr` job payload type and worker routing.
2. Update `make-pr` so it hands off to `check-pr` instead of cleaning up directly.
3. Add the Check PR module as the terminal receiver and move temporary repository cleanup into it.
4. Update tests for the new handoff and terminal cleanup ownership.
5. Run the standard validation commands.
