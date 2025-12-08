# Monorepo Architecture Guide

This document describes the clean hybrid monorepo architecture for the Poloniex Trading Platform, combining TypeScript/React frontend with Python computational backend and serverless database (Neon/Postgres).

## 📁 Directory Structure

```
poloniex-trading-platform/
├── apps/                           # Application packages
│   ├── web/                        # Vite + React 19 frontend application
│   │   ├── src/
│   │   ├── package.json            # @poloniex-platform/web
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   └── api/                        # Node.js + Express backend API
│       ├── src/
│       ├── package.json            # @poloniex-platform/api
│       └── tsconfig.json
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
├── shared/                         # Shared utilities and types
│   ├── types/                      # Shared type definitions
│   └── middleware/                 # Shared middleware
│
├── docker-compose.yml             # Local development orchestration
├── pnpm-workspace.yaml            # Workspace definition
├── package.json                   # Root package.json
└── README.md                      # Main README
```

## 🎯 Clean Architecture Benefits

This is a **clean, production-ready monorepo** with:
- ✅ `apps/web/` - React 19 + Vite frontend (@poloniex-platform/web)
- ✅ `apps/api/` - Node.js + Express backend (@poloniex-platform/api)
- ✅ `kernels/core/` - Python ML package (proprietary-core)
- ✅ `packages/*` - Shared UI, types, and database packages
- ✅ No legacy directories - single source of truth
- ✅ Unified workspace with yarn workspaces
- ✅ Type-safe contracts across the entire stack

### Architecture Principles

1. **Single Source of Truth** - Each component has one clear location
2. **Type Safety** - Zod, Pydantic, and TypeScript enforce contracts
3. **Separation of Concerns** - Apps, packages, kernels clearly separated
4. **Scalability** - Easy to add new apps or packages
5. **Developer Experience** - Clean imports, fast builds, clear structure

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
# Terminal 1: Web Frontend
yarn dev:web

# Terminal 2: API Backend
yarn dev:api

# Terminal 3: Python ML Worker
cd kernels/core
uvicorn health:app --reload --port 9080
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

### Yarn Workspaces
```bash
yarn workspace @poloniex-platform/web add <package>
yarn workspace @poloniex-platform/api add <package>
yarn workspace @poloniex-platform/ui add <package>
```

### PNPM Workspaces (Alternative)
```bash
pnpm add <package> --filter @poloniex-platform/ui
pnpm add <package> --filter @poloniex-platform/web
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
2. Backend API (`apps/api`)
3. Web Frontend (`apps/web`)

```bash
yarn build:packages
yarn build:api
yarn build:web
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

The core monorepo architecture is complete. Optional enhancements:

1. Implement Turborepo or Nx for parallel builds and caching
2. Add Storybook for UI component documentation
3. Setup CI/CD pipelines optimized for monorepo
4. Add end-to-end tests with Playwright/Cypress
5. Create additional apps as needed (admin panel, mobile, etc.)

## 🤝 Contributing

When adding new features:

1. **Web Component** → Add to `apps/web/src/components` or `packages/ui` if reusable
2. **API Endpoint** → Add to `apps/api/src/`
3. **Type Definition** → Add to `packages/ts-types`
4. **Database Change** → Update `packages/database/schema.ts`
5. **Python Model** → Update `kernels/core/proprietary_core/models`
6. **After API changes** → Run `yarn codegen:types`

Always maintain the validation triangle:
```
Database Schema ↔ Pydantic Model ↔ Zod Schema
```

## 📄 License

MIT License - see LICENSE file for details.
