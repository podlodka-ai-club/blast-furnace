## 1. Types and Routing
- [x] 1.1 Add or update routing and type tests for the new job kinds.
- [x] 1.2 Add shared job payload types for `plan`, `review`, and `make-pr`.
- [x] 1.3 Add worker routing for `plan`, `review`, and `make-pr` handlers.

## 2. Existing Handoffs
- [x] 2.1 Update existing job tests for the changed downstream job names, payloads, and Codex provider responsibilities.
- [x] 2.2 Update `issue-processor` so verified issue branches enqueue `plan` with the existing issue and branch data.
- [x] 2.3 Update `codex-provider` so successful development processing enqueues `review` with its received issue and branch data plus the temporary repository path.
- [x] 2.4 Remove deterministic commit, push, pull request creation, and label transition behavior from `codex-provider`.

## 3. New Pipeline Step Modules
- [x] 3.1 Add focused tests for each new module, including Make PR finalization behavior.
- [x] 3.2 Add an isolated Plan job module that enqueues `codex-provider` and forwards received data unchanged.
- [x] 3.3 Add an isolated Review job module that enqueues `make-pr` and forwards received data unchanged.
- [x] 3.4 Add an isolated Make PR job module that owns change detection, commit, push, pull request creation, label transition, and cleanup of the handed-off temporary repository.

## 4. Validation
- [x] 4.1 Run `npm test`.
- [x] 4.2 Run `npm run lint`.
- [x] 4.3 Run `npm run build`.
