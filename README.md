# Poloniex Trading Platform

A comprehensive trading platform for Poloniex with advanced features including automated trading, machine learning strategies, and Chrome extension integration.

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

### Deploying to Vercel

To deploy to Vercel (current default for `deploy` script):
```bash
yarn deploy
```
This uses the `scripts/deploy.js` file which is configured for Vercel deployments.

### Deploying to Railway

This project supports Railway deployment using a monorepo architecture with separate frontend and backend services.

#### Project Structure
```
poloniex-trading-platform/
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── yarn.lock
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── railway.json
│   ├── nixpacks.toml
│   └── Dockerfile (optional)
├── backend/
│   ├── src/
│   ├── package.json
│   ├── yarn.lock
│   ├── railway.json
│   ├── nixpacks.toml
│   └── Dockerfile (optional)
├── shared/
│   └── types/
├── railway.json (monorepo config)
├── package.json (root workspace)
└── yarn.lock (root)
```

#### Railway Configuration Options

**Option 1: Single Configuration File (Recommended)**

Uses the root `railway.json` with multi-service configuration:

1. **Frontend Service Settings**:
   - Service Name: `poloniex-frontend`
   - Root Directory: `/frontend`
   - Config Path: `/railway.json`
   - Builder: NIXPACKS

2. **Backend Service Settings**:
   - Service Name: `poloniex-backend`
   - Root Directory: `/backend`
   - Config Path: `/railway.json`
   - Builder: NIXPACKS

**Option 2: Separate Service Configurations**

Each service has its own `railway.json`:

1. **Frontend Service**:
   - Root Directory: `/frontend`
   - Config Path: `/frontend/railway.json`

2. **Backend Service**:
   - Root Directory: `/backend`
   - Config Path: `/backend/railway.json`

#### Environment Variables

**Frontend Variables**:
```bash
# Railway System Variables (auto-generated)
PORT=
RAILWAY_PUBLIC_DOMAIN=

# Application Variables
NODE_ENV=production
VITE_API_URL=${{backend.RAILWAY_PUBLIC_DOMAIN}}
VITE_WS_URL=wss://${{backend.RAILWAY_PUBLIC_DOMAIN}}
VITE_POLONIEX_API_KEY=your-key
VITE_POLONIEX_API_SECRET=your-secret
VITE_POLONIEX_PASSPHRASE=your-passphrase
```

**Backend Variables**:
```bash
# Railway System Variables (auto-generated)
PORT=
RAILWAY_PUBLIC_DOMAIN=

# Application Variables
NODE_ENV=production
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
POLONIEX_API_KEY=your-key
POLONIEX_SECRET=your-secret
JWT_SECRET=generate-secure-secret
SESSION_SECRET=generate-secure-secret
```

#### Deployment Steps

1. **Create Services**: Create two services in Railway project
2. **Connect Repository**: Connect GitHub repository to both services
3. **Configure Root Directories**:
   - Frontend: Set to `/frontend`
   - Backend: Set to `/backend`
4. **Set Environment Variables**: Add required variables per service
5. **Deploy**: Deploy backend first, then frontend

#### Build Commands

The workspace includes optimized build commands:
- `yarn build` - Builds both services
- `yarn build:frontend` - Builds frontend only
- `yarn build:backend` - Builds backend only
- `yarn start:frontend` - Starts frontend preview
- `yarn start:backend` - Starts backend server
- `yarn railway:help` - Get Railway configuration guidance
- `yarn railway:validate` - Validate Railway configuration files

#### Railway Troubleshooting

If you encounter Railway deployment issues, especially "config file does not exist" errors:

1. **Quick Help**: Run `yarn railway:help` for configuration guidance
2. **Detailed Guide**: See [RAILWAY_TROUBLESHOOTING_GUIDE.md](./RAILWAY_TROUBLESHOOTING_GUIDE.md)
3. **Validate Configs**: Run `yarn railway:validate` to check configuration files

Common solutions:
- Set Config Path to `/railway.json` with Root Directory `/backend` (recommended)
- Or set Config Path to `/backend/railway.json` with Root Directory `/backend`
- Or clear Config Path completely and use Railway UI configuration

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

<<<<<<< HEAD
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

>>>>>>> origin/main
## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Poloniex API for market data
- TensorFlow.js for machine learning capabilities
- React and Vite for the frontend framework