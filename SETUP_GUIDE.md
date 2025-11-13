# Poloniex Trading Platform - Setup Guide

## Current Status

### ✅ What's Working
- **Frontend**: Fully built and deployed to Railway
- **Backend**: Running on Railway with PostgreSQL database
- **Authentication**: JWT-based auth system functional
- **Database**: PostgreSQL configured and healthy
- **API Endpoints**: All backend routes operational
- **Autonomous Trading UI**: Complete with 6 major components

### ⚠️ What Needs Setup

#### 1. User Registration & Login
Users need to create an account to use the platform.

**Steps**:
1. Go to the deployed frontend: https://poloniex-trading-platform-production.up.railway.app
2. Click "Register" or "Sign Up"
3. Create an account with email and password
4. Log in with your credentials

#### 2. API Credentials Configuration
After logging in, users must configure their Poloniex API credentials.

**Steps**:
1. Log into Poloniex.com
2. Go to API Management
3. Create a new API key with required permissions:
   - Read account information
   - Read positions
   - Place orders (if using live trading)
4. Copy the API Key, Secret, and Passphrase
5. In the trading platform, go to **Settings** page
6. Enter your Poloniex credentials:
   - API Key
   - API Secret
   - Passphrase (if required)
7. Click **Save Settings**

**What Happens**:
- Credentials are saved to localStorage (frontend)
- Credentials are encrypted and stored in PostgreSQL database (backend)
- Backend can now fetch real balance and trading data from Poloniex

#### 3. Balance Display
Once API credentials are configured:
- Dashboard will show real account balance
- Positions will display actual open trades
- Trading features will use live data

---

## Architecture Overview

### Frontend (React + TypeScript + Vite)
- **URL**: https://poloniex-trading-platform-production.up.railway.app
- **Authentication**: JWT tokens stored in localStorage
- **API Communication**: Axios with interceptors for token refresh
- **State Management**: React Context + Hooks

### Backend (Node.js + Express + TypeScript)
- **URL**: https://polytrade-be.up.railway.app
- **Database**: PostgreSQL (Railway-hosted)
- **Authentication**: JWT with 1-hour access tokens, 7-day refresh tokens
- **API Credentials**: Encrypted storage using AES-256-GCM
- **Poloniex Integration**: V3 Futures API

### Database Schema
- **users**: User accounts with authentication
- **user_api_credentials**: Encrypted Poloniex API keys
- **futures_accounts**: Poloniex account data
- **futures_positions**: Open trading positions
- **autonomous_agent_sessions**: AI trading sessions
- **autonomous_agent_strategies**: Generated trading strategies
- **backtest_results**: Historical strategy performance

---

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Login and get JWT tokens
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/verify` - Verify token validity

### Credentials Management
- `POST /api/credentials` - Store encrypted API credentials
- `GET /api/credentials/status` - Check if credentials exist
- `DELETE /api/credentials` - Remove credentials

### Dashboard
- `GET /api/dashboard/overview` - Complete dashboard data
- `GET /api/dashboard/balance` - Account balance only
- `GET /api/dashboard/positions` - Active positions
- `GET /api/dashboard/balance/all` - Combined Spot + Futures balance

### Trading
- `GET /api/futures/balance` - Futures account balance
- `GET /api/futures/positions` - Open positions
- `POST /api/futures/order` - Place new order
- `DELETE /api/futures/order/:orderId` - Cancel order

### Autonomous Trading
- `POST /api/agent/start` - Start autonomous trading agent
- `POST /api/agent/stop` - Stop autonomous trading agent
- `GET /api/agent/status` - Get agent status
- `GET /api/agent/strategies` - List generated strategies
- `GET /api/agent/activity/live` - Real-time activity feed
- `GET /api/agent/performance` - Performance analytics

---

## Troubleshooting

### Issue: Balance Shows $0 or Mock Data

**Cause**: No API credentials configured in database

**Solution**:
1. Ensure you're logged in
2. Go to Settings page
3. Enter valid Poloniex API credentials
4. Click Save Settings
5. Refresh the Dashboard page

### Issue: "VITE_POLONIEX_API_KEY is not defined"

**Status**: ✅ FIXED in latest build

**What was fixed**:
- Removed client-side API key signing
- Frontend now uses JWT authentication to backend
- Backend handles all Poloniex API authentication

### Issue: ML Model Predictions Show "Not Available"

**Cause**: Python dependencies not installed

**Solution** (Backend):
```bash
cd backend
pip install -r requirements.txt
```

Required Python packages:
- numpy
- pandas
- scikit-learn
- tensorflow or pytorch

### Issue: Cannot Login or Register

**Check**:
1. Backend is running: https://polytrade-be.up.railway.app/api/health
2. Database is connected: https://polytrade-be.up.railway.app/api/status
3. Check browser console for errors
4. Verify network requests in DevTools

---

## Environment Variables

### Backend (Railway)
```env
# Database
DATABASE_URL=postgresql://...  # Automatically set by Railway

# JWT Authentication
JWT_SECRET=your-secret-key-here

# API Encryption
API_ENCRYPTION_KEY=your-32-byte-encryption-key

# Environment
NODE_ENV=production
PORT=3000
```

### Frontend (Railway)
```env
# Backend API
VITE_API_BASE_URL=https://polytrade-be.up.railway.app
VITE_BACKEND_URL=https://polytrade-be.up.railway.app

# Poloniex API (Public endpoints only)
VITE_POLONIEX_API_BASE_URL=https://api.poloniex.com

# WebSocket URLs
VITE_POLONIEX_FUTURES_WS_PUBLIC=wss://ws.poloniex.com/ws/v3/public
VITE_POLONIEX_FUTURES_WS_PRIVATE=wss://ws.poloniex.com/ws/v3/private
```

**Note**: Never put API keys/secrets in frontend environment variables!

---

## Security Best Practices

### ✅ Implemented
- JWT authentication with short-lived access tokens
- Refresh token rotation
- API credentials encrypted at rest (AES-256-GCM)
- HTTPS for all communications
- SQL injection prevention (parameterized queries)
- CORS configuration
- Rate limiting on API endpoints

### 🔒 User Responsibilities
- Use strong passwords
- Keep API keys secure
- Enable 2FA on Poloniex account
- Use API keys with minimal required permissions
- Regularly rotate API keys
- Monitor account activity

---

## Deployment

### Frontend Deployment (Railway)
```bash
cd frontend
npm run build
# Railway automatically deploys from git push
```

### Backend Deployment (Railway)
```bash
cd backend
npm run build:railway
# Railway automatically deploys from git push
```

### Database Migrations
```bash
cd backend
npm run migrate
```

---

## Development

### Local Development Setup

#### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or yarn

#### Backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your local database URL
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

#### Database Setup
```bash
cd backend
# Create PostgreSQL database
createdb poloniex_trading

# Run migrations
npm run migrate
```

---

## Features

### Dashboard
- Real-time account balance
- Open positions with P&L
- Recent trades
- Market overview
- Performance charts

### Trading
- Market orders
- Limit orders
- Stop loss / Take profit
- Position management
- Order history

### Autonomous Trading Agent
- AI-powered strategy generation
- Automated backtesting
- Paper trading validation
- Live trading execution
- Real-time performance monitoring
- Strategy approval workflow

### Backtesting
- Historical data analysis
- Strategy performance metrics
- Equity curve visualization
- Drawdown analysis
- Win rate and profit factor

### AI Strategy Generator
- Claude Sonnet 4.5 integration
- Multi-factor signal generation
- Risk-adjusted position sizing
- Automated strategy optimization

---

## Support

### Documentation
- Poloniex API Docs: https://docs.poloniex.com
- Railway Docs: https://docs.railway.app

### Common Issues
See Troubleshooting section above

### Logs
- Backend logs: Railway dashboard → polytrade-be → Logs
- Frontend logs: Browser DevTools → Console
- Database logs: Railway dashboard → PostgreSQL → Logs

---

## Next Steps

1. **Register an account** on the deployed platform
2. **Configure API credentials** in Settings
3. **Verify balance** displays correctly on Dashboard
4. **Test paper trading** before live trading
5. **Enable autonomous agent** for AI-powered trading
6. **Monitor performance** through analytics dashboard

---

## Version Information

- **Platform Version**: 1.0.0
- **Backend API**: v1
- **Poloniex API**: v3 (Futures)
- **Last Updated**: 2025-11-12

---

## License

Proprietary - All rights reserved
