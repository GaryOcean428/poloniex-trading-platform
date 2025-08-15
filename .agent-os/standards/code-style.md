# Code Style

- TypeScript strict mode, no `any` unless justified.
- ESLint + Prettier are the source of truth.
- React 19: use Server Components only if project is Next.js; otherwise Vite SPA patterns.
- Naming: `camelCase` for variables/functions, `PascalCase` for components/types.
- Testing: write Vitest unit tests for critical utils/components.
- Logging: use centralized logger; no `console.log` in production code.
- Errors: prefer typed errors and narrowing; never swallow errors.
