# Execute Tasks

Purpose: Coordinate a set of tasks to implement a spec end-to-end.

Process:
1. Read spec and extract sub-tasks with estimates
2. Create a branch naming plan
3. Implement in small PRs (<300 LOC per edit)
4. Add/adjust tests with Vitest/Jest as applicable
5. Run format/lint; fix TypeScript errors
6. Verify dev servers on explicit ports (FE 567x, BE 876x)
7. Update docs and changelog

Quality Gates:
- TypeScript build passes with zero new errors
- Lint passes; no `any` without justification
- Tests pass locally
- Logs free of noisy console prints
