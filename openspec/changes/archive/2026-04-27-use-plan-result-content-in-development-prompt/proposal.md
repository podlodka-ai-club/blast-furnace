## Why

Develop currently builds its Codex prompt inline and passes serialized plan metadata instead of centering the validated implementation plan text. This makes the stage prompt harder to evolve and risks giving Codex a less direct execution brief than the Plan stage produced.

## What Changes

- Add a repository-owned Develop prompt template at `prompts/develop.md`.
- Update Develop prompt rendering to use only the validated Plan result content as the execution brief.
- Launch Development in a fresh Codex session instead of continuing the Plan session.
- Share Codex invocation helpers between Plan and Develop, using the newer Plan helper behavior as the baseline.
- Add focused tests for Develop prompt rendering and executor invocation with template-rendered plan content.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `develop-job`: Develop prompt construction changes from inline JSON plan context to rendering a repository-owned template with validated Plan result content, and Development explicitly starts a new Codex session.

## Impact

- Affects `src/jobs/develop.ts`, `src/jobs/plan.ts`, `src/jobs/develop.test.ts`, Plan helper coverage, and `prompts/develop.md`.
- No API, queue payload, dependency, or database changes.
