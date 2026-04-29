## 1. Test Coverage

- [x] 1.1 Add Plan prompt rendering tests for issue title, issue description, empty-description fallback, and absence of assessment context.
- [x] 1.2 Add YAML plan-check loading tests for valid required titles, malformed YAML, missing `requiredTitles`, and non-string title entries.
- [x] 1.3 Add required-title validation tests for case-insensitive Markdown headings, missing headings, and whitespace-trimmed heading text.
- [x] 1.4 Add Plan flow tests for a successful first Codex attempt that appends a successful Plan handoff record and enqueues Develop with the new handoff reference.
- [x] 1.5 Add Plan flow tests for failed first and second validation attempts that append non-terminal Plan handoff records and continue in the same injected Codex session.
- [x] 1.6 Add Plan flow tests for a third failed validation attempt that appends a terminal blocked Plan handoff record and does not enqueue Develop.
- [x] 1.7 Add handoff/type contract tests for the updated Plan output shape, including successful and validation-failed Plan results.

## 2. Prompt And Check Assets

- [x] 2.1 Add the hardcoded Plan prompt template file with placeholders for issue title and issue description.
- [x] 2.2 Add the hardcoded Plan checks YAML file with the default required response titles.
- [x] 2.3 Add or update project dependencies for YAML parsing using the repository's package management conventions.

## 3. Plan Helpers

- [x] 3.1 Implement a Plan-owned prompt renderer that loads the template, replaces supported placeholders, and applies the empty-description fallback.
- [x] 3.2 Implement a strict YAML checks loader that returns validated required titles and fails before Codex invocation when configuration is invalid.
- [x] 3.3 Implement required-title validation that inspects Markdown headings and reports missing titles in a human-readable failure reason.
- [x] 3.4 Add or extract a Codex execution helper that Plan can use to launch Codex, send continuation prompts in one session, capture normalized response text, and support fake executor injection in tests.

## 4. Plan Flow Implementation

- [x] 4.1 Extend Plan result and runtime handoff schemas to represent `success` and `validation-failed` Plan results with content, summary, and failure reason fields.
- [x] 4.2 Replace the stub Plan output path with initial prompt rendering, checks loading, Codex execution, and deterministic response validation.
- [x] 4.3 Record every Codex planning attempt in the JSONL handoff ledger with the attempt content, validation status, and dependency on the previous input or attempt record.
- [x] 4.4 Retry validation failures with a hardcoded continuation prompt in the same Plan Codex session for up to three total Codex attempts.
- [x] 4.5 On first or second validation failure, append a non-terminal `rework-needed` Plan handoff record with `toStage: 'plan'` and continue planning.
- [x] 4.6 On the third validation failure, append a terminal non-urgent blocked Plan handoff record with no downstream stage and do not enqueue Develop.
- [x] 4.7 On validation success, append a successful Plan handoff record containing the accepted plan content and enqueue Develop with the successful handoff record reference.

## 5. Verification

- [x] 5.1 Run focused Plan tests and fix any failures.
- [x] 5.2 Run handoff contract and shared type tests and fix any failures.
- [x] 5.3 Run the full test suite.
- [x] 5.4 Run `openspec validate add-plan-implementation --strict`.
