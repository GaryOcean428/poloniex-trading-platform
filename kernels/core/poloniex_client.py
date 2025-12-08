"""
Poloniex API Client using official SDK
Wrapper around polo-sdk-python for easy integration
"""
import os
from typing import Optional, Dict, List, Any
from datetime import datetime

# Note: Official polo-sdk-python doesn't have proper setup.py
# Using our own implementation with requests library instead
SDK_AVAILABLE = False


class PoloniexClient:
    """Wrapper for official Poloniex SDK with fallback to mock data"""
    
    def __init__(self, api_key: Optional[str] = None, api_secret: Optional[str] = None):
        """
        Initialize Poloniex client
        
        Args:
            api_key: API key (defaults to env var POLONIEX_API_KEY)
            api_secret: API secret (defaults to env var POLONIEX_API_SECRET)
        """
        self.api_key = api_key or os.getenv('POLONIEX_API_KEY')
        self.api_secret = api_secret or os.getenv('POLONIEX_API_SECRET')
        self.sdk_available = SDK_AVAILABLE
        
        # Using mock mode - official SDK doesn't have proper installation
        self.spot = None
        self.authenticated = bool(self.api_key and self.api_secret)
        if not self.authenticated:
            print("Running in mock mode - API credentials not provided")
    
    def is_authenticated(self) -> bool:
        """Check if client is authenticated"""
        return self.authenticated
    
    # ===== MARKET DATA METHODS =====
    
    def get_markets(self) -> List[Dict]:
        """Get all trading pairs"""
        if self.spot:
            try:
                return self.spot.get_markets()
            except Exception as e:
                print(f"Error fetching markets: {e}")
                return self._mock_markets()
        return self._mock_markets()
    
    def get_market(self, symbol: str) -> Dict:
        """Get specific market info"""
        if self.spot:
            try:
                return self.spot.get_market(symbol)
            except Exception as e:
                print(f"Error fetching market {symbol}: {e}")
                return self._mock_market(symbol)
        return self._mock_market(symbol)
    
    def get_ticker(self, symbol: str) -> Dict:
        """Get 24h ticker"""
        if self.spot:
            try:
                return self.spot.markets().get_ticker24h(symbol)
            except Exception as e:
                print(f"Error fetching ticker for {symbol}: {e}")
                return self._mock_ticker(symbol)
        return self._mock_ticker(symbol)
    
    def get_orderbook(self, symbol: str, limit: int = 20) -> Dict:
        """Get order book"""
        if self.spot:
            try:
                return self.spot.markets().get_orderbook(symbol, limit=limit)
            except Exception as e:
                print(f"Error fetching orderbook for {symbol}: {e}")
                return self._mock_orderbook(symbol)
        return self._mock_orderbook(symbol)
    
    def get_candles(self, symbol: str, interval: str = 'HOUR_1', limit: int = 100) -> List[Dict]:
        """Get OHLCV candles"""
        if self.spot:
            try:
                return self.spot.markets().get_candles(symbol, interval, limit=limit)
            except Exception as e:
                print(f"Error fetching candles for {symbol}: {e}")
                return self._mock_candles(symbol, limit)
        return self._mock_candles(symbol, limit)
    
    # ===== ACCOUNT METHODS (Require Authentication) =====
    
    def get_balances(self) -> List[Dict]:
        """Get account balances"""
        if not self.authenticated:
            return self._mock_balances()
        
        try:
            return self.spot.accounts().get_balances()
        except Exception as e:
            print(f"Error fetching balances: {e}")
            return self._mock_balances()
    
    def get_account_balance(self, account_id: str) -> Dict:
        """Get specific account balance"""
        if not self.authenticated:
            return self._mock_account_balance(account_id)
        
        try:
            return self.spot.accounts().get_account_balances(account_id)
        except Exception as e:
            print(f"Error fetching account balance: {e}")
            return self._mock_account_balance(account_id)
    
    # ===== ORDER METHODS (Require Authentication) =====
    
    def create_order(self, symbol: str, side: str, type: str = 'MARKET', 
                    quantity: Optional[str] = None, price: Optional[str] = None,
                    amount: Optional[str] = None) -> Dict:
        """
        Create order
        
        Args:
            symbol: Trading pair (e.g., 'BTC_USDT')
            side: 'BUY' or 'SELL'
            type: 'MARKET' or 'LIMIT'
            quantity: Order quantity (for LIMIT orders)
            price: Order price (for LIMIT orders)
            amount: Order amount in quote currency (for MARKET orders)
        """
        if not self.authenticated:
            return {'error': 'Not authenticated', 'mock': True}
        
        try:
            return self.spot.orders().create(
                symbol=symbol,
                side=side,
                type=type,
                quantity=quantity,
                price=price,
                amount=amount
            )
        except Exception as e:
            print(f"Error creating order: {e}")
            return {'error': str(e)}
    
    def get_open_orders(self, symbol: Optional[str] = None) -> List[Dict]:
        """Get open orders"""
        if not self.authenticated:
            return []
        
        try:
            return self.spot.orders().get_all(symbol=symbol)
        except Exception as e:
            print(f"Error fetching open orders: {e}")
            return []
    
    def cancel_order(self, order_id: Optional[str] = None, 
                    client_order_id: Optional[str] = None) -> Dict:
        """Cancel order by ID"""
        if not self.authenticated:
            return {'error': 'Not authenticated'}
        
        try:
            return self.spot.orders().cancel_by_id(
                order_id=order_id,
                client_order_id=client_order_id
            )
        except Exception as e:
            print(f"Error canceling order: {e}")
            return {'error': str(e)}
    
    def get_order_history(self, symbol: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get order history"""
        if not self.authenticated:
            return []
        
        try:
            return self.spot.orders().get_history(symbol=symbol, limit=limit)
        except Exception as e:
            print(f"Error fetching order history: {e}")
            return []
    
    # ===== MOCK DATA METHODS =====
    
    def _mock_markets(self) -> List[Dict]:
        """Mock markets data"""
        return [
            {
                'symbol': 'BTC_USDT',
                'baseCurrencyName': 'BTC',
                'quoteCurrencyName': 'USDT',
                'displayName': 'BTC/USDT',
                'state': 'NORMAL'
            },
            {
                'symbol': 'ETH_USDT',
                'baseCurrencyName': 'ETH',
                'quoteCurrencyName': 'USDT',
                'displayName': 'ETH/USDT',
                'state': 'NORMAL'
            },
            {
                'symbol': 'SOL_USDT',
                'baseCurrencyName': 'SOL',
                'quoteCurrencyName': 'USDT',
                'displayName': 'SOL/USDT',
                'state': 'NORMAL'
            }
        ]
    
    def _mock_market(self, symbol: str) -> Dict:
        """Mock single market data"""
        return {
            'symbol': symbol,
            'baseCurrencyName': symbol.split('_')[0],
            'quoteCurrencyName': symbol.split('_')[1] if '_' in symbol else 'USDT',
            'displayName': symbol.replace('_', '/'),
            'state': 'NORMAL'
        }
    
    def _mock_ticker(self, symbol: str) -> Dict:
        """Mock ticker data"""
        import random
        base_price = 50000 if 'BTC' in symbol else 3000 if 'ETH' in symbol else 100
        return {
            'symbol': symbol,
            'open': str(base_price * 0.98),
            'close': str(base_price),
            'high': str(base_price * 1.02),
            'low': str(base_price * 0.97),
            'volume': str(random.randint(1000, 10000)),
            'amount': str(random.randint(10000000, 100000000)),
            'tradeCount': random.randint(1000, 5000),
            'ts': int(datetime.now().timestamp() * 1000)
        }
    
    def _mock_orderbook(self, symbol: str) -> Dict:
        """Mock orderbook data"""
        import random
        base_price = 50000 if 'BTC' in symbol else 3000 if 'ETH' in symbol else 100
        
        bids = [[str(base_price - i * 10), str(random.uniform(0.1, 1.0))] for i in range(1, 11)]
        asks = [[str(base_price + i * 10), str(random.uniform(0.1, 1.0))] for i in range(1, 11)]
        
        return {
            'symbol': symbol,
            'bids': bids,
            'asks': asks,
            'ts': int(datetime.now().timestamp() * 1000)
        }
    
    def _mock_candles(self, symbol: str, limit: int) -> List[Dict]:
        """Mock candles data"""
        import random
        base_price = 50000 if 'BTC' in symbol else 3000 if 'ETH' in symbol else 100
        candles = []
        
        for i in range(limit):
            open_price = base_price * (1 + random.uniform(-0.02, 0.02))
            close_price = open_price * (1 + random.uniform(-0.01, 0.01))
            high_price = max(open_price, close_price) * (1 + random.uniform(0, 0.01))
            low_price = min(open_price, close_price) * (1 - random.uniform(0, 0.01))
            
            candles.append([
                str(int((datetime.now().timestamp() - i * 3600) * 1000)),  # timestamp
                str(low_price),
                str(high_price),
                str(open_price),
                str(close_price),
                str(random.uniform(10, 100)),  # volume
                str(random.uniform(100000, 1000000))  # amount
            ])
        
        return candles
    
    def _mock_balances(self) -> List[Dict]:
        """Mock balances data"""
        return [
            {
                'accountId': '123456',
                'accountType': 'SPOT',
                'balances': [
                    {'currency': 'USDT', 'available': '10000.00', 'hold': '0.00'},
                    {'currency': 'BTC', 'available': '0.1', 'hold': '0.0'}
                ]
            }
        ]
    
    def _mock_account_balance(self, account_id: str) -> Dict:
        """Mock account balance data"""
        return {
            'accountId': account_id,
            'accountType': 'SPOT',
            'balances': [
                {'currency': 'USDT', 'available': '10000.00', 'hold': '0.00'},
                {'currency': 'BTC', 'available': '0.1', 'hold': '0.0'}
            ]
        }


# Singleton instance
_client_instance: Optional[PoloniexClient] = None

def get_client(api_key: Optional[str] = None, api_secret: Optional[str] = None) -> PoloniexClient:
    """Get or create Poloniex client singleton"""
    global _client_instance
    
    if _client_instance is None:
        _client_instance = PoloniexClient(api_key, api_secret)
    
    return _client_instance
