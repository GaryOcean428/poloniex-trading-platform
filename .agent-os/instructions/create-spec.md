# Create Spec

Purpose: Write a high-fidelity spec for a single feature or epic.

Required sections:
- Summary: one paragraph
- User stories: Given/When/Then acceptance criteria
- Non-functional requirements: performance, security, accessibility
- API and data contracts: request/response typing (TypeScript interfaces)
- UX: wireframes or textual description, states and error cases
- Testing plan: unit (Vitest), integration, mocks
- Rollout plan: flags, metrics, fallback

Constraints:
- Use TypeScript-first interfaces and strict typing
- No runtime changes to package manager; use Yarn 4 commands
- Ports must follow our ranges

Checklist before sign-off:
- [ ] All states covered (loading, error, empty)
- [ ] API contracts typed
- [ ] Test plan defined
- [ ] Security and error handling addressed
