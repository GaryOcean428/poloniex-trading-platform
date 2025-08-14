# Tech Stack (Polytrade)

- Language: TypeScript 5.5+
- Runtime: Node 22.x LTS
- Package Manager: Yarn 4.9.x (nodeLinker: node-modules)
- Frontend: React 19, Vite 4.4.7+ or Next.js 15.1.6+ (current app uses Vite React)
- Backend: Express/Node
- Styling: Tailwind (if present) / CSS Modules
- Testing: Vitest (frontend), Jest (backend if used)
- Linting/Format: ESLint + Prettier
- CI/CD: Railway/Vercel as configured
- Realtime: Socket.IO / WebSocket
- DB: Supabase (if present) or project-specific

Notes:
- Prefer Yarn commands (yarn up, yarn install). Avoid npm/pnpm unless discussed.
- Frontend dev ports: 5675-5699; Backend: 8765-8799.
- Always specify ports explicitly to avoid conflicts.
