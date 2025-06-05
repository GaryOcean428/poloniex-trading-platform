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

- Node.js (v16 or higher)
- npm (v8 or higher)
- Chrome browser (for extension features)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/GaryOcean428/poloniex-trading-platform.git
cd poloniex-trading-platform
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your API keys:
```
VITE_POLONIEX_API_KEY=your_api_key
VITE_POLONIEX_API_SECRET=your_api_secret
VITE_BACKEND_URL=http://localhost:3000
```

When deploying to Vercel, you can omit `VITE_BACKEND_URL` so the frontend calls
the built-in serverless functions under the same domain.

### Development

Start the development server:
```bash
npm run dev
```

### Testing

Run the test suite:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

### Production

Check if the application is ready for production:
```bash
npm run production-check
```

Build for production:
```bash
npm run build
```

Deploy to production:
```bash
npm run deploy
```

### Serverless Functions on Vercel

The `/api` directory contains Vercel serverless functions. During deployment,
these functions are built and hosted alongside the frontend. The `health`
endpoint can be reached at `/api/health` to verify the backend is running.

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

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Poloniex API for market data
- TensorFlow.js for machine learning capabilities
- React and Vite for the frontend framework
