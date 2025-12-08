# Monorepo Architecture Guide

This document describes the hybrid monorepo architecture for the Poloniex Trading Platform, combining TypeScript/React frontend with Python computational backend and serverless database (Neon/Postgres).

## 📁 Directory Structure

```
poloniex-trading-platform/
├── apps/                           # Application packages (future)
│   ├── web/                        # Next.js or Vite React App (migrate from frontend/)
│   └── api/                        # Node.js Express backend (migrate from backend/)
│
├── packages/                       # Shared packages
│   ├── ui/                         # Shared React UI components
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── ts-types/                   # Auto-generated & shared TypeScript types
│   │   ├── src/
│   │   │   ├── schemas/           # Zod validation schemas
│   │   │   └── generated/         # Generated from OpenAPI
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── database/                   # Drizzle ORM schema & migrations
│       ├── src/
│       │   ├── client.ts          # Database client
│       │   └── schema.ts          # Table definitions
│       └── package.json
│
├── kernels/                        # Proprietary computation kernels
│   ├── core/                       # Core Python/ML logic as installable package
│   │   ├── proprietary_core/      # Python package
│   │   │   ├── __init__.py
│   │   │   └── models/            # Pydantic validation models
│   │   ├── pyproject.toml         # Package definition (uv/Poetry)
│   │   └── main.py                # FastAPI service entry
│   ├── bindings/                   # Language bindings (C++/Rust if needed)
│   ├── Dockerfile                  # Container for ML worker
│   └── README.md
│
├── data/                           # Raw JSON data sources
│   ├── markets/                    # Market data
│   ├── config/                     # Configuration files
│   ├── samples/                    # Sample/test data
│   └── README.md
│
├── tooling/                        # Shared configurations
│   ├── tsconfig.base.json          # Base TypeScript config
│   ├── .eslintrc.base.js          # Base ESLint config
│   └── .prettierrc.json           # Prettier config
│
├── scripts/                        # Build & deployment scripts
│   └── codegen/
│       └── generate-types.mjs     # OpenAPI → TypeScript generator
│
├── generated/                      # Auto-generated files
│   └── openapi.json               # API contract from FastAPI
│
├── frontend/                       # Current frontend (legacy location)
├── backend/                        # Current backend (legacy location)
├── python-services/               # Current Python services (legacy location)
├── shared/                         # Current shared code (to be migrated)
│
├── docker-compose.yml             # Local development orchestration
├── pnpm-workspace.yaml            # Workspace definition
├── package.json                   # Root package.json
└── README.md                      # This file
```

## 🔄 Migration Strategy

The repository is currently in transition from the old structure to the new monorepo architecture:

### Current State (Legacy)
- `frontend/` - React + Vite application
- `backend/` - Node.js + Express API
- `python-services/poloniex/` - Python ML worker
- `packages/ts-types/` - Shared types

### Target State (New)
- `apps/web/` - React + Vite (migrated from frontend/)
- `apps/api/` - Node.js API (migrated from backend/)
- `kernels/core/` - Python kernels (migrated from python-services/)
- `packages/*` - Enhanced shared packages

### Migration Path
1. ✅ Create new directory structure
2. ✅ Setup workspace configuration (pnpm-workspace.yaml)
3. ✅ Create shared tooling (tsconfig.base.json, ESLint, Prettier)
4. ✅ Setup packages (ui, database, enhanced ts-types)
5. ✅ Create kernels structure with installable Python package
6. ✅ Add validation layers (Zod, Pydantic)
7. ✅ Setup docker-compose for local development
8. ⏳ Migrate frontend to apps/web
9. ⏳ Migrate backend to apps/api
10. ⏳ Update imports and references
11. ⏳ Test and validate

## 🔗 Shared Contracts & Type Safety

### The "Glue": Keeping TS + Python in Sync

#### 1. Database Schema (Source of Truth)
```typescript
// packages/database/src/schema.ts
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull(),
  // ...
});
```

#### 2. Python Backend (Pydantic Models)
```python
# kernels/core/proprietary_core/models/__init__.py
class User(BaseModel):
    username: str = Field(..., min_length=3)
    email: str
    # Mirrors DB schema
```

#### 3. TypeScript Frontend (Zod Schemas)
```typescript
// packages/ts-types/src/schemas/index.ts
export const UserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  // Mirrors Pydantic model
});
```

#### 4. OpenAPI → TypeScript (Auto-generated)
```bash
# Generate types from Python backend
yarn codegen:types

# This creates:
# packages/ts-types/src/generated/api-types.ts
```

### Data Flow with Validation

```
JSON Input
    ↓
[Frontend: Zod Validation]
    ↓
Typed API Client (from OpenAPI)
    ↓
[Backend: Pydantic Validation]
    ↓
Proprietary Kernel (imported as library)
    ↓
[Database: Drizzle Schema]
    ↓
Result (type-safe all the way)
```

## 🛠️ Development Workflow

### Local Development (Docker Compose)

Start all services:
```bash
yarn docker:up
```

Services available at:
- Frontend: http://localhost:5675
- Backend API: http://localhost:8765
- Python ML Worker: http://localhost:9080
- PostgreSQL: localhost:5432
- Redis: localhost:6379

View logs:
```bash
yarn docker:logs
```

Stop services:
```bash
yarn docker:down
```

### Local Development (Native)

1. **Install Dependencies**
```bash
yarn install
```

2. **Build Packages**
```bash
yarn build:packages
```

3. **Start Development Servers**
```bash
# Terminal 1: Frontend
yarn dev:frontend

# Terminal 2: Backend
yarn dev:backend

# Terminal 3: Python ML Worker
cd kernels/core
uvicorn main:app --reload --port 9080
```

### Type Generation

When the Python backend API changes:
```bash
yarn codegen:types
```

This will:
1. Fetch OpenAPI spec from Python backend
2. Generate TypeScript types
3. Update packages/ts-types/src/generated/

## 📦 Package Management

### Yarn Workspaces (Current)
```bash
yarn workspace frontend add <package>
yarn workspace backend add <package>
yarn workspace @poloniex-platform/ui add <package>
```

### PNPM Workspaces (Future - Optional)
```bash
pnpm add <package> --filter @poloniex-platform/ui
pnpm add <package> --filter frontend
```

### Python Dependencies (uv)
```bash
cd kernels/core
uv pip install <package>
uv pip install -e ".[dev]"  # Install in development mode
```

## 🏗️ Build System

### TypeScript Packages
Each package extends the base config:
```json
// packages/ui/tsconfig.json
{
  "extends": "../../tooling/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Build Order
1. Shared packages first (`packages/*`)
2. Backend (`apps/api` or `backend/`)
3. Frontend (`apps/web` or `frontend/`)

```bash
yarn build:packages
yarn build:backend
yarn build:frontend
```

## 🔒 Environment Variables

Create `.env` file in root:
```bash
# Copy from template
cp .env.example .env
```

Key variables:
- `DATABASE_URL` - Postgres connection (Neon for production)
- `JWT_SECRET` - Backend authentication
- `VITE_API_URL` - Frontend → Backend communication
- `PYTHON_API_URL` - Backend → Python ML Worker communication

## 🧪 Testing

Run all tests:
```bash
yarn test:run
```

Run with coverage:
```bash
yarn test:coverage
```

Run Python tests:
```bash
cd kernels/core
pytest
```

## 📝 Code Quality

Lint all packages:
```bash
yarn lint
```

Fix linting issues:
```bash
yarn lint:fix
```

Run quality checks:
```bash
yarn quality:check
```

## 🚀 Deployment

### Railway (Current)
See `RAILWAY_QUICK_REFERENCE.md` for Railway deployment.

### Docker Production
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

## 📚 Additional Resources

- [Kernels README](kernels/README.md) - Python kernel development
- [Data README](data/README.md) - Data management and validation
- [Database Package](packages/database/README.md) - Schema and migrations
- [Type Generation](scripts/codegen/README.md) - OpenAPI type generation

## 🎯 Next Steps

1. Complete migration of frontend → apps/web
2. Complete migration of backend → apps/api
3. Implement Turborepo or Nx for parallel builds
4. Add Storybook for UI component documentation
5. Setup CI/CD pipelines for monorepo
6. Add end-to-end tests with Playwright/Cypress

## 🤝 Contributing

When adding new features:

1. **Frontend Component** → Add to `packages/ui` if reusable
2. **Type Definition** → Add to `packages/ts-types`
3. **Database Change** → Update `packages/database/schema.ts`
4. **Python Model** → Update `kernels/core/proprietary_core/models`
5. **API Endpoint** → Update FastAPI, run `yarn codegen:types`

Always maintain the validation triangle:
```
Database Schema ↔ Pydantic Model ↔ Zod Schema
```

## 📄 License

MIT License - see LICENSE file for details.
