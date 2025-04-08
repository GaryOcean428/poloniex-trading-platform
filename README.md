# Poloniex Trading Platform

## Local Development & Testing

1. Start the development server:
```bash
npm run dev
```

2. Load the Chrome extension:
- Open Chrome and go to `chrome://extensions`
- Enable "Developer mode" in the top right
- Click "Load unpacked" and select the `extension` folder from this project

3. Testing modes:
- **Mock Mode**: By default, all API calls use mock data in development
- **Live Testing**: To test with real API:
  1. Add your Poloniex API credentials in Settings
  2. Enable "Live Trading" mode
  3. The extension will connect to your Poloniex account

4. Extension Features:
- TradingView integration: Visit TradingView to test chart data extraction
- Poloniex integration: Visit Poloniex to test trading features
- Account sync: Extension saves login state between sessions

## Production Deployment

1. Build the application:
```bash
npm run build
```

2. Package the extension:
- Update `manifest.json` with production URLs
- Zip the extension folder for Chrome Web Store submission

3. Deploy the web application:
```bash
npm run deploy
```

## Environment Variables

Create a `.env` file with:
```
VITE_POLONIEX_API_KEY=your_api_key
VITE_POLONIEX_API_SECRET=your_api_secret
```

## Security Notes

- API keys are stored securely in Chrome's extension storage
- All trading actions require explicit user confirmation
- Mock mode prevents accidental real trades during testing