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

This project can be deployed to Railway using a two-service architecture: a backend API service and a frontend static site service.

**1. Backend Service (API)**

*   **Creation**: In Railway, create a new service and connect it to your GitHub repository.
*   **Configuration**:
    *   In the Railway service settings (for this backend service), navigate to the "Config-as-code" section and set the "Railway Config File" path to `railway.json`. This instructs Railway to use our `railway.json` file, which is configured to build the service using the `backend.Dockerfile` (renamed from `Dockerfile` to allow the frontend service to default to Nixpacks).
    *   A `.dockerignore` file is also present in the root to ensure a clean build by preventing local development files (like `node_modules/` and `.env`) from interfering with the Docker build process.
    *   The `backend.Dockerfile` sets up the Node.js environment and runs `server/index.js`.
    *   The `railway.json` also specifies a health check at `/api/health`.
*   **Environment Variables**: Set these in the Railway service dashboard:
    *   `VITE_POLONIEX_API_KEY`: Your Poloniex API key (if the backend needs to make authenticated calls - currently `server/index.js` uses public websockets, but other functionality might require it).
    *   `PORT`: Railway sets this automatically. The server is configured to use it.
    *   *(Add any other necessary backend variables here, e.g., database URLs, if your project evolves to use them).*

**2. Frontend Service (Static Site)**

*   **Creation**: In Railway, create another new service, also connected to your GitHub repository.
*   **Configuration**:
    *   In the Railway service settings (for this frontend service):
        *   Ensure **no path is set** for the "Railway Config File" (under "Config-as-code"). This service will be configured directly via the UI settings.
        *   Select **Nixpacks** as the builder (it should default to this, as no `Dockerfile` is present in the root).
        *   Set the **Build Command** to `yarn build`.
        *   Set the **Publish Directory** to `dist`. Railway will serve the static files from this directory.
*   **Environment Variables**: Set these in the Railway service dashboard:
    *   `VITE_BACKEND_URL`: **Crucial.** This must be the public URL of your deployed backend service on Railway (e.g., `https://your-backend-service-name.up.railway.app`).
    *   `VITE_POLONIEX_API_KEY`: Your Poloniex API key, if your *frontend client code* makes direct authenticated API calls to Poloniex.
    *   *(Add any other necessary frontend Vite variables here).*

**General Railway Tips:**
*   After deploying, check the deployment logs in Railway for both services to ensure everything started correctly.
*   Use the service URLs provided by Railway to access your frontend application and backend API.
*   Manage environment variables securely through the Railway dashboard.

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

This practice ensures that dependency resolution is consistent. The `yarn install --frozen-lockfile` command used in Docker builds relies on an up-to-date and consistent `yarn.lock` file generated by the correct Yarn version.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Poloniex API for market data
- TensorFlow.js for machine learning capabilities
- React and Vite for the frontend framework