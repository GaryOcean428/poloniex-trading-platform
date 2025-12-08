# Monorepo Quick Start Guide

Quick reference for working with the new hybrid monorepo architecture.

## 🚀 Getting Started

### First Time Setup

```bash
# 1. Enable Corepack (if not already enabled)
corepack enable

# 2. Install all dependencies
yarn install

# 3. Initialize data directory
yarn setup:data

# 4. Build shared packages
yarn build:packages
```

### Development

**Start all services with Docker:**
```bash
yarn docker:up          # Start all services
yarn docker:logs        # View logs
yarn docker:down        # Stop all services
```

**Start services individually:**
```bash
# Terminal 1: Web Frontend
yarn dev:web

# Terminal 2: API Backend
yarn dev:api

# Terminal 3: Python ML Worker
cd kernels/core
uvicorn health:app --reload --port 9080
```

## 📦 Package Management

### Adding Dependencies

**To a workspace package:**
```bash
yarn workspace @poloniex-platform/web add <package>
yarn workspace @poloniex-platform/api add <package>
yarn workspace @poloniex-platform/ui add <package>
```

**To Python kernel:**
```bash
cd kernels/core
uv pip install <package>
```

### Building Packages

```bash
# Build individual packages
yarn workspace @poloniex-platform/ts-types build
yarn workspace @poloniex-platform/ui build
yarn workspace @poloniex-platform/database build

# Build all packages
yarn build:packages

# Build applications
yarn build:web
yarn build:api
```

## 🔄 Type Generation

**Generate TypeScript types from Python backend:**
```bash
# Ensure Python ML worker is running on localhost:9080
yarn codegen:types
```

This will:
1. Fetch OpenAPI spec from Python backend
2. Generate TypeScript types
3. Update `packages/ts-types/src/generated/`

## 📝 Component Organization

### Using Barrel Files

**Import components cleanly:**
```typescript
// Before (verbose)
import Login from '@/components/auth/Login';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// After (clean)
import { Login, ProtectedRoute } from '@/components/auth';
```

**Available barrel exports:**
- `@/components/auth` - Authentication components
- `@/components/dashboard` - Dashboard widgets
- `@/components/trading` - Trading panels
- `@/components/ui` - UI primitives
- `@/components` - All components (consolidated)

### Creating New Components

```typescript
// 1. Create component file
// apps/web/src/components/feature/MyComponent.tsx

// 2. Add to barrel file
// apps/web/src/components/feature/index.ts
export { default as MyComponent } from './MyComponent';

// 3. Import cleanly
import { MyComponent } from '@/components/feature';
```

## ✅ Validation

### Frontend (Zod)

```typescript
import { DataMarketDataSchema, validateData } from '@poloniex-platform/ts-types/schemas';

// Validate data
const validData = validateData(DataMarketDataSchema, jsonData);

// Safe validation
const result = safeValidateData(DataMarketDataSchema, jsonData);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error);
}
```

### Backend (Pydantic)

```python
from proprietary_core.models import MarketData

# Validate data
data = MarketData(**json_data)

# Will raise ValidationError if invalid
```

## 🗄️ Database

### Using Drizzle ORM

```typescript
import { db } from '@poloniex-platform/database';
import { users, trades } from '@poloniex-platform/database/schema';

// Query
const allUsers = await db.select().from(users);

// Insert
await db.insert(trades).values({
  userId: 1,
  symbol: 'BTC_USDT',
  // ...
});
```

### Migrations

```bash
cd packages/database

# Generate migration
yarn generate

# Run migrations
yarn migrate

# Open Drizzle Studio
yarn studio
```

## 🧪 Testing & Quality

```bash
# Run tests
yarn test:run

# Run with coverage
yarn test:coverage

# Lint all code
yarn lint

# Fix linting issues
yarn lint:fix

# Complete quality check
yarn quality:check
```

## 🐍 Python Development

### Install as Library

```bash
cd kernels/core

# Install in development mode
uv pip install -e .

# Install with dev dependencies
uv pip install -e ".[dev]"
```

### Run Tests

```bash
cd kernels/core
pytest
```

### Linting

```bash
cd kernels/core

# Check code
ruff check .

# Fix issues
ruff check . --fix

# Type checking
mypy .
```

## 🔧 Configuration Files

### Shared TypeScript Config

Packages extend from `tooling/tsconfig.base.json`:

```json
{
  "extends": "../../tooling/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Shared ESLint Config

Packages can extend from `tooling/.eslintrc.base.js`:

```js
module.exports = {
  extends: ['../../tooling/.eslintrc.base.js'],
  // Additional rules
};
```

## 📊 Data Management

### Adding Data Files

```bash
# Add to appropriate directory
data/markets/symbols.json
data/config/strategies.json
data/samples/test_data.json
```

### Validation Required

Always validate JSON data:
- Frontend: Use Zod schemas
- Backend: Use Pydantic models

## 🐳 Docker

### Services

| Service | Port | Health Endpoint |
|---------|------|-----------------|
| Frontend | 5675 | `/healthz` |
| Backend API | 8765 | `/api/health` |
| Python ML | 9080 | `/health` |
| PostgreSQL | 5432 | - |
| Redis | 6379 | - |

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=postgresql://poloniex:password@localhost:5432/poloniex_trading

# API Keys
POLONIEX_API_KEY=your-key
POLONIEX_API_SECRET=your-secret

# Service URLs
VITE_API_URL=http://localhost:8765
PYTHON_API_URL=http://localhost:9080
```

## 🚢 Deployment

### Railway

See `RAILWAY_QUICK_REFERENCE.md` for detailed Railway deployment instructions.

**Quick validation:**
```bash
yarn railway:validate
```

### Production Build

```bash
# Build everything
yarn build

# Or build individually
yarn build:api
yarn build:web
```

## 📚 Documentation

- **[MONOREPO_ARCHITECTURE.md](MONOREPO_ARCHITECTURE.md)** - Complete architecture guide
- **[kernels/README.md](kernels/README.md)** - Python kernel development
- **[data/README.md](data/README.md)** - Data management
- **[README.md](README.md)** - Main project README

## 🔍 Troubleshooting

### TypeScript Build Errors

```bash
# Clean and rebuild
cd packages/ts-types
yarn clean
yarn build
```

### Docker Issues

```bash
# Reset everything
docker-compose down -v
yarn docker:up
```

### Python Issues

```bash
# Reinstall dependencies
cd kernels/core
uv pip install --force-reinstall -e ".[dev]"
```

### Yarn Issues

```bash
# Clear cache and reinstall
yarn cache clean
rm -rf node_modules
yarn install
```

## 💡 Best Practices

1. **Always validate external data** with Zod (frontend) or Pydantic (backend)
2. **Use barrel files** for clean imports
3. **Keep validation models in sync** between TS and Python
4. **Run type generation** after backend API changes
5. **Test locally with Docker** before deploying
6. **Use shared configs** from `tooling/` for consistency
7. **Document new packages** with README files

## 🎯 Architecture Complete

The monorepo is fully migrated and production-ready:
- ✅ Clean structure with `apps/`, `packages/`, `kernels/`
- ✅ No legacy directories
- ✅ Unified workspace configuration
- ✅ All builds working

Optional enhancements:
- Add Turborepo/Nx for build caching
- Setup Storybook for UI components
- Add E2E tests with Playwright/Cypress

## 🤝 Contributing

When adding features:

1. **New reusable component?** → Add to `packages/ui`
2. **New type?** → Add to `packages/ts-types`
3. **Database change?** → Update `packages/database/schema.ts`
4. **Python model?** → Update `kernels/core/proprietary_core/models`
5. **API change?** → Update FastAPI, run `yarn codegen:types`

Always maintain the validation triangle:
```
Database Schema ↔ Pydantic Model ↔ Zod Schema
```

---

Need help? Check the full documentation in [MONOREPO_ARCHITECTURE.md](MONOREPO_ARCHITECTURE.md).
