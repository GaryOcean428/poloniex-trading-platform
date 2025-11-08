# Poloniex Trading Platform

A comprehensive trading platform for Poloniex with advanced features including automated trading, machine learning strategies, and Chrome extension integration.

## 🚀 Quick Start

**New to the project?** Start here:
- 📖 **[QUICK_START.md](QUICK_START.md)** - Get up and running in minutes
- 🚂 **[RAILWAY_QUICK_REFERENCE.md](RAILWAY_QUICK_REFERENCE.md)** - Railway deployment quick reference
- ✅ **Deployment Validation:** Run `yarn deploy:check` to verify readiness
- 📋 **Implementation Status:** See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for complete assessment response

**Production Ready:** All deployment requirements validated ✅

## Features

- **Live Data Integration**: Real-time market data with WebSocket connections and fallback mechanisms
- **Automated Trading**: Strategy-based automated trading with customizable parameters
- **Machine Learning Trading**: ML-based prediction models for market movements
- **Deep Q-Network Trading**: Reinforcement learning approach to trading decisions
- **Model Recalibration**: Automatic model adjustment to prevent overfitting
- **Chrome Extension Integration**: Seamless integration with Chrome extension for enhanced functionality
- **Comprehensive Testing**: Extensive test suite for all components and features
- **Error Recovery**: Robust error handling and recovery mechanisms

## Getting Started

### Prerequisites

- Node.js (v20 or higher)
- npm (v8 or higher)
- Chrome browser (for extension features)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/GaryOcean428/poloniex-trading-platform.git
cd poloniex-trading-platform
```

2. Enable Corepack and install dependencies (the project uses Yarn Berry specified in `package.json`'s `packageManager` field):
```bash
corepack enable yarn
yarn install
```

3. Create a `.env` file in the root directory with your API keys:
```
VITE_POLONIEX_API_KEY=your_api_key
VITE_POLONIEX_API_SECRET=your_api_secret
VITE_BACKEND_URL=http://localhost:3000
```

### Development

Start the development server:
```bash
yarn dev
```

### Testing

Run the test suite:
```bash
yarn test
```

Run tests with coverage:
```bash
yarn test:coverage
```

### Production

Check if the application is ready for production:
```bash
yarn production-check
```

Build for production:
```bash
yarn build
```

## Deployment

### Pre-Deployment Validation

Before deploying, verify all requirements are met:

```bash
yarn deploy:check
yarn deploy:check:frontend  # Frontend-specific validation
```

✅ All validation checks should pass. See [QUICK_START.md](QUICK_START.md) for deployment guide and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for detailed implementation status.

### Troubleshooting

If you encounter a **blank page in production**, see the comprehensive troubleshooting guide:
- [TROUBLESHOOTING_BLANK_PAGE.md](TROUBLESHOOTING_BLANK_PAGE.md) - Solutions for blank page issues

For Railway deployment issues:
- **[RAILWAY_QUICK_REFERENCE.md](RAILWAY_QUICK_REFERENCE.md)** - Quick reference for common Railway tasks
- **[docs/RAILWAY_RAILPACK_CHEATSHEET.md](docs/RAILWAY_RAILPACK_CHEATSHEET.md)** - Comprehensive Railway + Railpack deployment guide
- [RAILWAY_CONFIGURATION.md](RAILWAY_CONFIGURATION.md) - Complete Railway setup guide
- [RAILWAY_DEPLOYMENT_CHECKLIST.md](RAILWAY_DEPLOYMENT_CHECKLIST.md) - Step-by-step deployment checklist

### Deploying to Railway

This project is optimized for Railway deployment using **Railpack v1** in a monorepo architecture with three separate services:

#### 📚 Railway Documentation

- **[RAILWAY_QUICK_REFERENCE.md](RAILWAY_QUICK_REFERENCE.md)** - Quick reference for common Railway tasks and troubleshooting
- **[docs/RAILWAY_RAILPACK_CHEATSHEET.md](docs/RAILWAY_RAILPACK_CHEATSHEET.md)** - Comprehensive Railway + Railpack deployment guide with:
  - Verified railpack.json configurations
  - Port binding patterns and health check implementations
  - Common issues and solutions with code examples
  - Performance optimization and security best practices
- **[RAILWAY_DEPLOYMENT_CHECKLIST.md](RAILWAY_DEPLOYMENT_CHECKLIST.md)** - Step-by-step deployment checklist
- **[RAILWAY_CONFIGURATION.md](RAILWAY_CONFIGURATION.md)** - Detailed Railway settings and environment variables

#### Project Structure (Railpack v1)
```
poloniex-trading-platform/
├── railpack.json                        # Root coordination file
├── frontend/                            # React 19 + Vite frontend
│   ├── railpack.json                    # Frontend Railpack config
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── yarn.lock
│   ├── serve.js                         # Production static server
│   └── vite.config.ts
├── backend/                             # Node.js + Express backend
│   ├── railpack.json                    # Backend Railpack config
│   ├── src/
│   ├── package.json
│   ├── yarn.lock
│   ├── tsconfig.json
│   └── dist/                           # TypeScript build output
├── python-services/
│   └── poloniex/                       # Python 3.13.2 + FastAPI ML worker
│       ├── railpack.json               # Python Railpack config
│       ├── main.py
│       └── requirements.txt
├── shared/                             # Shared types and utilities
│   └── types/
├── package.json                        # Root workspace
└── yarn.lock                           # Root lockfile
```

#### Railway Service Configuration

| Service | Root Directory | Port | Health Endpoint | Railway Service ID |
|---------|---------------|------|-----------------|-------------------|
| **Frontend (polytrade-fe)** | `./frontend` | 5675 | `/healthz`, `/api/health` | c81963d4-f110-49cf-8dc0-311d1e3dcf7e |
| **Backend (polytrade-be)** | `./backend` | 8765 | `/api/health` | e473a919-acf9-458b-ade3-82119e4fabf6 |
| **ML Worker (ml-worker)** | `./python-services/poloniex` | 9080 | `/health` | 86494460-6c19-4861-859b-3f4bd76cb652 |

**Technology Stack:**
- Node.js: 20.x LTS (managed by Railpack)
- Yarn: 4.9.2 (managed by Corepack)
- Python: 3.13.2 (exact version)
- React: 19.x
- TypeScript: 5.9+

#### Environment Variables

**Frontend Service (polytrade-fe):**
```bash
PORT=${{PORT}}                           # Auto-provided by Railway
NODE_ENV=production
VITE_API_URL=${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{polytrade-be.RAILWAY_PUBLIC_DOMAIN}}
```

**Backend Service (polytrade-be):**
```bash
PORT=${{PORT}}                           # Auto-provided by Railway
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<generate-secure-secret>
FRONTEND_URL=${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
CORS_ORIGIN=${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}
```

**Python Service (ml-worker):**
```bash
PORT=${{PORT}}                           # Auto-provided by Railway
PYTHONUNBUFFERED=1
BACKEND_URL=${{polytrade-be.RAILWAY_PRIVATE_DOMAIN}}
```

#### Deployment Steps

For complete deployment instructions, see **[RAILWAY_QUICK_REFERENCE.md](RAILWAY_QUICK_REFERENCE.md)** or **[docs/RAILWAY_RAILPACK_CHEATSHEET.md](docs/RAILWAY_RAILPACK_CHEATSHEET.md)**.

**Quick Steps:**
1. **Pre-deployment validation**: Run `yarn railway:validate`
2. **Configure Railway services**: Set root directories for each service
3. **Set environment variables**: Add required variables per service
4. **Deploy**: Push to GitHub - Railway auto-deploys from main branch

#### Build Commands

The workspace includes optimized build commands:
- `yarn build` - Builds both frontend and backend
- `yarn build:frontend` - Builds frontend only
- `yarn build:backend` - Builds backend only
- `yarn railway:validate` - Validate Railway/Railpack configuration files
- `yarn deploy:check` - Verify deployment readiness

#### Railway Troubleshooting

For Railway deployment issues:
1. **Quick Reference**: See [RAILWAY_QUICK_REFERENCE.md](RAILWAY_QUICK_REFERENCE.md)
2. **Comprehensive Guide**: See [docs/RAILWAY_RAILPACK_CHEATSHEET.md](docs/RAILWAY_RAILPACK_CHEATSHEET.md)
3. **Step-by-step**: See [RAILWAY_DEPLOYMENT_CHECKLIST.md](RAILWAY_DEPLOYMENT_CHECKLIST.md)
4. **Validate Configs**: Run `yarn railway:validate` to check configuration files

Common solutions in the comprehensive guide include:
- Fixing "Install inputs must be an image or step input" errors
- Resolving "No project found in /app" issues
- Health check timeout configuration
- Port binding patterns for all services

## Architecture

The application is built with a modular architecture:

- **Core Components**: React-based UI components
- **Context Providers**: State management using React Context API
- **Services**: API integrations and data processing
- **Hooks**: Custom React hooks for business logic
- **ML Models**: TensorFlow.js-based machine learning models
- **Extension Integration**: Chrome extension communication layer

## Advanced Trading Features

### Machine Learning Trading

The ML trading system uses historical data to predict market movements:

- Feature engineering from market data
- Model training with adjustable parameters
- Prediction confidence scoring
- Automated trade execution based on predictions

### Deep Q-Network Trading

The DQN trading system uses reinforcement learning:

- State representation of market conditions
- Action space for trading decisions
- Reward function based on profit/loss
- Experience replay for improved learning
- Target network for stable training

### Model Recalibration

The model recalibration system prevents overfitting:

- Performance monitoring over time
- Automatic detection of model drift
- Periodic retraining with new data
- Hyperparameter optimization
- Confidence calibration

## Chrome Extension Integration

The Chrome extension provides additional functionality:

- Real-time notifications
- Quick trading actions
- Market monitoring
- Custom alerts

## Dependency Management (Yarn Berry & Corepack) and Node Versioning

### Node.js Version Consistency
This project uses Node.js. The required version is specified in the `engines` field in `package.json` (e.g., `>=20.0.0`) and is also used in the `backend.Dockerfile`.

### Yarn Berry and Corepack
This project uses Yarn Berry (version specified in `package.json`'s `packageManager` field). Corepack, which is bundled with Node.js v16.10+, is used to manage the Yarn version.

**Local Development Setup:**
1.  Ensure you have Node.js installed (version matching `engines.node` in `package.json`).
2.  Enable Corepack for Yarn (if not already enabled):
    ```bash
    corepack enable yarn
    ```
3.  Install dependencies:
    ```bash
    yarn install
    ```
    Corepack will automatically use the Yarn Berry version specified in `package.json`.

**Updating Dependencies or Node Version:**
When changing the Node.js version (locally, in Dockerfile, or `package.json` `engines`) or updating dependencies:
1.  Ensure your local development environment matches the intended Node.js version.
2.  Run `yarn install` to update dependencies and the `yarn.lock` file.
3.  Commit the updated `yarn.lock` file (and `package.json` if dependencies changed) to the repository.

This practice ensures that dependency resolution is consistent. The `yarn install --immutable` command used in Docker builds relies on an up-to-date and consistent `yarn.lock` file generated by the correct Yarn version.

=======
## Security & Deployment Notes

### Environment Variables & Secrets
- **All secrets must be configured via environment variables** (see `.env.example`)
- **Never commit API keys or secrets to the repository**
- JWT secrets must be changed from default values for production
- Use Railway's secret management for sensitive values in production

### Health Check Requirements
- **Backend**: `/api/health` and `/healthz` endpoints must be live for Railway monitoring
- **Frontend**: `/healthz` endpoint configured for Railway health checks
- **ML Worker**: `/health` and `/healthz` endpoints configured for monitoring
- Health check timeout configured to 300 seconds for all services

### CORS Policy
The application enforces strict CORS policies for security:
- **Allowed Origins**: Only trusted frontend URLs are permitted
- **Methods**: `GET`, `POST` only
- **Credentials**: `true` for cookie-based authentication
- **Production**: CORS must restrict to trusted frontend origins only
- **Development**: Includes localhost origins for local development

CORS origins are configured via:
- `FRONTEND_URL` environment variable for primary frontend
- `CORS_ALLOWED_ORIGINS` for multiple trusted domains
- Railway reference variables for dynamic domain resolution

### Deployment Security Checklist
- [ ] All API keys and secrets configured via environment variables
- [ ] JWT secrets changed from default values  
- [ ] Health check endpoints responding correctly
- [ ] CORS restricted to trusted origins only
- [ ] Database connections using Railway managed URLs
- [ ] No hardcoded credentials in source code

### Railway-Specific Security
- Use Railway reference variables for service communication: `${{service.RAILWAY_PUBLIC_DOMAIN}}`
- Internal traffic uses `.railway.internal` domains
- Public traffic uses HTTPS-only endpoints
- Database connections use `${{Postgres.DATABASE_URL}}` references

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Poloniex API for market data
- TensorFlow.js for machine learning capabilities
- React and Vite for the frontend framework
# Force rebuild Fri Nov  7 22:31:25 EST 2025
# Build ID: 1762575060
