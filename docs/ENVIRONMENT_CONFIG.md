# Environment Configuration

This document describes the environment variables and configuration options for the Poloniex Trading Platform.

## Required Environment Variables for Production

### Poloniex API Credentials

```bash
# Required for live trading
VITE_POLONIEX_API_KEY=your_poloniex_api_key_here
VITE_POLONIEX_API_SECRET=your_poloniex_api_secret_here  
VITE_POLONIEX_PASSPHRASE=your_poloniex_passphrase_here
```

**Important**: 
- These credentials are required for live trading functionality
- Without valid credentials, the application will show error messages instead of falling back to mock mode
- Store these securely and never commit them to version control

### API Configuration (Optional)

```bash
# Override default API endpoints (optional)
VITE_API_URL=https://futures-api.poloniex.com/v3

# Alternative for Next.js compatibility
NEXT_PUBLIC_API_URL=https://futures-api.poloniex.com/v3
```

**When to use**:
- Custom or proxy API endpoints
- Regional API endpoints
- Development/staging environments with different API URLs

## Mock Mode Configuration

### Explicit Mock Mode Control

```bash
# Force enable mock mode (overrides all other settings)
VITE_FORCE_MOCK_MODE=true

# Force disable mock mode (requires valid credentials)
VITE_DISABLE_MOCK_MODE=true
```

**Important**: 
- `VITE_FORCE_MOCK_MODE=true` will use simulated data even with valid credentials
- `VITE_DISABLE_MOCK_MODE=true` will prevent fallback to mock mode and show errors instead
- Only one should be used at a time

### Mock Mode Behavior

| Environment | Credentials | Force Mock | Disable Mock | Result |
|-------------|-------------|------------|--------------|---------|
| Production  | Valid       | false      | false        | Live Trading |
| Production  | Invalid     | false      | false        | Error Messages |
| Production  | Valid       | true       | false        | Mock Mode |
| Production  | Invalid     | false      | true         | Error Messages |
| Development | Valid       | false      | false        | Live Trading |
| Development | Invalid     | false      | false        | Mock Mode |
| WebContainer| Any         | Any        | Any          | Mock Mode |

## Vercel Deployment

### Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add the following variables:

```bash
# Required for live trading
VITE_POLONIEX_API_KEY=your_actual_api_key
VITE_POLONIEX_API_SECRET=your_actual_api_secret
VITE_POLONIEX_PASSPHRASE=your_actual_passphrase

# Optional: Custom API URL
VITE_API_URL=https://futures-api.poloniex.com/v3

# Optional: Force mock mode for demo deployments
VITE_FORCE_MOCK_MODE=false
```

### Deployment Scenarios

**Production Deployment**:
```bash
VITE_POLONIEX_API_KEY=prod_key
VITE_POLONIEX_API_SECRET=prod_secret
VITE_POLONIEX_PASSPHRASE=prod_passphrase
VITE_DISABLE_MOCK_MODE=true  # Ensure no fallback to mock
```

**Demo Deployment**:
```bash
VITE_FORCE_MOCK_MODE=true  # Always use mock data
```

**Development Deployment**:
```bash
VITE_POLONIEX_API_KEY=dev_key
VITE_POLONIEX_API_SECRET=dev_secret
VITE_POLONIEX_PASSPHRASE=dev_passphrase
# Mock mode will be used if credentials are invalid
```

## Error Handling

### API Connection Errors

When API calls fail, the application will:

1. **Show specific error messages** instead of silently falling back to mock data
2. **Display error boundaries** with guidance on how to fix issues
3. **Provide retry functionality** for transient errors
4. **Guide users to settings** for authentication issues

### Error Types

- **Authentication Errors**: Invalid or missing API credentials
- **Connection Errors**: Network issues or API unavailability  
- **API Errors**: Invalid requests or API-specific errors

### Error Recovery

- **Retry buttons** for connection errors
- **Settings links** for authentication errors
- **Documentation links** for general API issues
- **Clear error messages** explaining the problem and solution

## Local Development

### .env File

Create a `.env` file in the project root:

```bash
# Copy from .env.example and fill in your values
VITE_POLONIEX_API_KEY=your_dev_api_key
VITE_POLONIEX_API_SECRET=your_dev_api_secret
VITE_POLONIEX_PASSPHRASE=your_dev_passphrase

# Optional: Enable mock mode for development
VITE_FORCE_MOCK_MODE=true
```

### Development vs Production

- **Development**: Can fall back to mock mode if no credentials provided
- **Production**: Shows errors instead of falling back to mock mode
- **WebContainer**: Always uses mock mode for browser-based development

## Troubleshooting

### Common Issues

1. **Blank UI/Navigation**: Usually caused by missing API credentials in production
   - Solution: Add valid `VITE_POLONIEX_API_*` environment variables

2. **API Errors**: Check credentials and network connectivity
   - Verify API key permissions on Poloniex
   - Check IP whitelist settings
   - Verify passphrase matches

3. **Mock Mode in Production**: Check environment variable configuration
   - Ensure `VITE_FORCE_MOCK_MODE` is not set to `true`
   - Verify credentials are valid

### Debug Information

The application logs useful information to the browser console:
- Environment detection results
- Mock mode status and reasoning
- API call attempts and results
- Error details and causes

Check the browser console for detailed diagnostic information.