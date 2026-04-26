## Context

Blast Furnace currently has two repository-selection sources in the production workflow. Intake reads `github:repos` from Redis and, when entries exist, polls every registered repository. It then passes a `repository` object through queue payloads. At the same time, GitHub branch refs, pull request creation, issue label transitions, and git remote URL construction use `config.github.owner`, `config.github.repo`, and `config.github.token`.

That split makes it possible for runtime state to describe one source repository while deterministic GitHub/git side effects target another. The target state for this iteration is explicitly single-repository operation: the orchestrator runs for one repository configured by environment and does not support a multi-repo workflow.

## Goals / Non-Goals

**Goals:**

- Make `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN` the only production repository selection mechanism.
- Stop production intake from reading or honoring `github:repos`.
- Keep queue payload repository identity only as derived context for the configured repository.
- Fail stale or mismatched downstream jobs before branch, clone, PR, or label side effects.
- Remove or disable repository registry API/UI surfaces so operators cannot configure behavior that runtime no longer supports.
- Update tests, docs, and OpenSpec so single-repo operation is the explicit contract.

**Non-Goals:**

- Adding multi-repo support through another mechanism.
- Changing issue eligibility beyond polling open issues labeled `ready`.
- Changing the target workflow order or stage handoff model.
- Changing terminal failure cleanup policy; that is tracked as a separate deferred task.
- Migrating or deleting existing Redis `github:repos` data automatically.

## Decisions

1. Use configured repository as the single source of truth.

   Add a small shared helper for the configured repository identity, or otherwise centralize the comparison so intake and stage validation use the same owner/repo values. Intake should build `createPrepareRunPayload()` with that configured identity and should call `fetchIssues()` without any owner/repo override.

   Alternative considered: keep reading `github:repos` but filter it down to entries matching `GITHUB_OWNER`/`GITHUB_REPO`. That preserves a misleading registry surface and still suggests multi-repo support exists.

2. Remove owner/repo override behavior from GitHub issue fetching.

   `fetchIssues()` should accept issue filters such as labels, state, assignee, since, and milestone, but repository routing should come from configuration only. Branch refs, pull requests, label transitions, and git remote URL construction already use configuration and should remain that way.

   Alternative considered: leave owner/repo override parameters for tests or future use. That keeps the ambiguity this change is removing and makes it easy for future code to reintroduce mixed-repository processing.

3. Validate downstream payload repository identity before side effects.

   Prepare Run, Make PR, and Sync Tracker State should reject a payload whose `repository` does not match the configured repository before performing GitHub or git side effects. This protects against stale queued jobs created before the change, manual queue injection, and future regressions. Stages between Prepare Run and Make PR may continue to preserve repository context as part of queue data, but it is not a routing selector.

   Alternative considered: ignore `job.data.repository` everywhere downstream. That avoids failures for stale jobs but hides inconsistent state and can produce confusing run artifacts.

4. Remove repository registry surfaces from the runtime contract.

   Stop registering `/repos` and `/repos/manage` in the application server, and retire route/UI modules and tests if they have no non-runtime use. Leaving routes active would let operators add repositories that the production intake ignores, which is worse than a clear missing-route response.

   Alternative considered: keep the routes as no-op diagnostics. That would require a new product contract and UI copy for a feature that should not exist in the target runtime.

5. Leave stale Redis registry data in place.

   Runtime should not read `github:repos`, so old entries are inert. Operators may clear them manually if desired, but no startup migration is required for correctness.

   Alternative considered: delete `github:repos` automatically on startup. That introduces an unnecessary Redis side effect and complicates rollback.

## Risks / Trade-offs

- Existing deployments using `/repos` or `/repos/manage` to add polling targets will lose that behavior -> Document the breaking change and require `GITHUB_OWNER`/`GITHUB_REPO` for the single supported target.
- Stale queued jobs carrying a different repository will fail -> This is intentional fail-fast behavior that prevents cross-repository side effects.
- Removing owner/repo overrides from issue fetching can require test fixture churn -> Update tests around the configured repository contract instead of preserving override-only behavior.
- Repository route removal may affect scripts or local tooling -> Missing-route behavior is clearer than accepting configuration that runtime ignores.

## Migration Plan

1. Update OpenSpec delta specs to define single-repo runtime behavior.
2. Add regression tests for intake ignoring `github:repos`, configured-repository GitHub fetching, and downstream repository mismatch failures.
3. Remove production intake reads of `github:repos` and remove owner/repo overrides from issue fetching.
4. Add or centralize configured repository identity validation and apply it before Prepare Run, Make PR, and Sync Tracker State side effects.
5. Remove repository route registration and retire repository registry API/UI modules and tests.
6. Update README and orchestration docs to remove repository registry and multi-repo polling guidance.
7. Run focused tests, full tests, lint, build, and OpenSpec validation.

Rollback is a code revert of this change. Redis registry data does not need restoration because this change does not delete it.

## Open Questions

- None.
