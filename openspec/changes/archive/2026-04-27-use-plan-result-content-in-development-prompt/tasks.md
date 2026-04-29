## 1. Prompt Template

- [x] 1.1 Add `prompts/develop.md` with a placeholder for accepted Plan content.
- [x] 1.2 Export a hardcoded Develop prompt template path from `src/jobs/develop.ts`.

## 2. Develop Prompt Rendering

- [x] 2.1 Add a Develop prompt renderer that loads the template and replaces explicit placeholders.
- [x] 2.2 Pass `PlanOutput.plan.content` into the rendered prompt instead of serialized Plan metadata.
- [x] 2.3 Ensure Develop does not add issue number, issue title, or issue description outside the accepted Plan content.

## 3. Codex Helpers

- [x] 3.1 Extract shared Codex command/session helpers from the newer Plan implementation for use by both Plan and Develop.
- [x] 3.2 Keep Plan continuation attempts able to resume the Plan session through the shared helper.
- [x] 3.3 Ensure Develop starts a new Codex session through the shared helper and does not resume the Plan session.

## 4. Tests

- [x] 4.1 Add focused unit coverage for Develop prompt rendering with accepted Plan content only.
- [x] 4.2 Update executor invocation coverage to assert the Codex prompt contains accepted Plan content and not serialized Plan metadata.
- [x] 4.3 Add or preserve coverage proving Plan can resume its own planning session while Develop starts a fresh session.

## 5. Verification

- [x] 5.1 Run the focused Plan and Develop job tests.
- [x] 5.2 Run the full test suite or document any environment blocker.
