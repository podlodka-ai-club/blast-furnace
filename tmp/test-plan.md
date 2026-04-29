# Develop Plan Structure

Use this structure as the required output contract for the `plan-job` substantive plan artifact. The artifact should be emitted as Markdown for human readability, but every section below is required and must use stable IDs so validation can cross-check coverage, ordering, scope, and preflight readiness.

## 1. Plan Metadata

```yaml
plan_version: 1
task_id: "<issue-or-task-id>"
repository: "<owner/name or local path>"
branch: "<target branch>"
workspace_path: "<absolute workspace path>"
source_context:
  issue_title: "<title>"
  issue_url: "<url or null>"
  assessment_record: "<handoff record id or null>"
status: "ready_for_develop"
```

Validation intent: confirms the plan is tied to one task, one repository, one workspace, and the assessed handoff that produced it.

## 2. Task Interpretation

### Goal

One concise paragraph describing the requested outcome in implementation terms.

### Must Haves

Each must-have must be derived from the task text, assessment, project docs, or repository evidence.

| ID | Requirement | Source | Evidence Link | Covered By Steps |
| --- | --- | --- | --- | --- |
| MH-001 | `<required behavior or constraint>` | `<task/assessment/spec/file>` | `<file path, spec path, issue URL, or line ref>` | `STEP-001, STEP-002` |

### Non Goals

| ID | Out-of-scope Item | Reason |
| --- | --- | --- |
| NG-001 | `<work not included>` | `<why this is outside the task>` |

Validation intent: supports `must_haves_derivation`, `task_completeness`, and `scope_sanity` by making requirements explicit, sourced, and mapped to steps.

## 3. Repository Context And Key Links

List only links needed by Develop to implement safely. Include files that are likely to be edited, files that define contracts, and tests that should be created or updated.

| ID | Type | Path / URL | Why It Matters | Expected Action |
| --- | --- | --- | --- | --- |
| KL-001 | `implementation` | `<path>` | `<relevant contract or behavior>` | `read/update/create/no-change` |
| KL-002 | `test` | `<path>` | `<coverage target>` | `read/update/create/no-change` |
| KL-003 | `spec` | `<path or URL>` | `<requirement source>` | `read/no-change` |

Validation intent: supports `key_links_planned` by forcing concrete repository/spec references before Develop starts.

## 4. Execution Plan

Every step must be atomic enough for Develop to execute or verify, must reference the must-haves it satisfies, and must declare dependencies using earlier step IDs only.

| Step ID | Phase | Action | Depends On | Satisfies | Key Links | Completion Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| STEP-001 | `preflight` | `Run/read B3 context check and confirm target files/contracts exist.` | `none` | `MH-001` | `KL-001, KL-003` | `<expected observable result>` |
| STEP-002 | `preflight` | `Run/read B4 verification check and confirm test/build commands are known.` | `STEP-001` | `MH-001` | `KL-002` | `<expected observable result>` |
| STEP-003 | `test` | `<write or update failing regression/behavior test first>` | `STEP-002` | `MH-001` | `KL-002` | `<test fails for expected reason>` |
| STEP-004 | `implementation` | `<smallest implementation change>` | `STEP-003` | `MH-001` | `KL-001` | `<behavior exists>` |
| STEP-005 | `verification` | `<run focused tests/lint/build>` | `STEP-004` | `MH-001` | `KL-002` | `<command passes>` |

Allowed phases: `preflight`, `test`, `implementation`, `migration`, `documentation`, `verification`, `handoff`.

Validation intent: supports `task_completeness`, `dependency_correctness`, `regression_safety`, and `preflight B3/B4 checks` by making dependency edges, TDD ordering, and evidence explicit.

## 5. Dependency Graph

```yaml
nodes:
  - STEP-001
  - STEP-002
  - STEP-003
  - STEP-004
  - STEP-005
edges:
  - from: STEP-001
    to: STEP-002
  - from: STEP-002
    to: STEP-003
  - from: STEP-003
    to: STEP-004
  - from: STEP-004
    to: STEP-005
```

Validation intent: enables deterministic topological checks: all dependencies exist, point backward in the plan, and form an acyclic graph.

## 6. Regression Safety

| Risk ID | Potential Regression | Trigger Area | Guardrail | Verification Step |
| --- | --- | --- | --- | --- |
| RISK-001 | `<what could break>` | `<module/API/flow>` | `<test/check/review constraint>` | `STEP-005` |

Validation intent: supports `regression_safety` by tying each risk to a concrete verification step instead of generic caution.

## 7. Scope Sanity Check

| Check | Required Answer |
| --- | --- |
| Does every implementation step map to at least one must-have? | `yes` |
| Are all non-goals excluded from implementation steps? | `yes` |
| Are unrelated refactors, style rewrites, dependency upgrades, and broad cleanup excluded unless explicitly required? | `yes` |
| Are side effects limited to the target repository/workspace and planned files? | `yes` |

Validation intent: supports `scope_sanity` with explicit yes/no assertions that can be checked against step mappings and changed-file plans.

## 8. Preflight B3/B4 Checks

### B3: Context And Contract Readiness

| Item | Expected Evidence | Result |
| --- | --- | --- |
| Target repository/workspace is accessible | `<absolute path or checkout evidence>` | `planned` |
| Relevant specs/docs/contracts are linked in Key Links | `KL-*` | `planned` |
| Candidate implementation and test files are linked in Key Links | `KL-*` | `planned` |
| Task ambiguity or missing information is recorded | `<none or BLOCKER-* id>` | `planned` |

### B4: Verification Readiness

| Item | Expected Evidence | Result |
| --- | --- | --- |
| Focused failing test path is planned before implementation | `STEP-*` | `planned` |
| Focused verification command is named | `<command>` | `planned` |
| Broader regression command is named when appropriate | `<command or not applicable with reason>` | `planned` |
| Known environment risks are listed | `<none or RISK-* id>` | `planned` |

Validation intent: forces Develop to start from known context and known verification commands before changing code.

## 9. Blockers And Assumptions

| ID | Type | Description | Required Resolution |
| --- | --- | --- | --- |
| ASM-001 | `assumption` | `<reasonable assumption>` | `<how Develop should validate it>` |
| BLOCKER-001 | `blocker` | `<missing info preventing safe execution>` | `<question/action needed before implementation>` |

Validation intent: prevents hidden uncertainty from being treated as implementation scope.

## 10. Develop Handoff Summary

Short instructions to Develop:

- Execute steps in dependency order.
- Do not implement non-goals.
- Write or update tests before implementation when the plan includes a `test` phase.
- Stop and report if a B3/B4 preflight item fails or a blocker is confirmed.
- Record any intentional deviation from this plan with the affected `STEP-*`, `MH-*`, and `RISK-*` IDs.
