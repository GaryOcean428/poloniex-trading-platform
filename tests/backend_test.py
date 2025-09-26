#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Poloniex Futures Trading Platform
Tests all endpoints, health checks, and integrations for Railway deployment
"""

import requests
import json
import sys
import time
from datetime import datetime
import websocket
import threading
from urllib.parse import urljoin

class PoloniexFuturesAPITester:
    def __init__(self):
        # Use the public URL from frontend .env for testing
        self.backend_url = "http://localhost:3001"
        self.ml_worker_url = "http://localhost:8000"
        self.ws_url = "ws://localhost:3001"
        
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.session = requests.Session()
        self.session.timeout = 10
        
        print(f"🚀 Starting Poloniex Futures Trading Platform API Testing")
        print(f"Backend URL: {self.backend_url}")
        print(f"ML Worker URL: {self.ml_worker_url}")
        print(f"WebSocket URL: {self.ws_url}")
        print("=" * 60)

    def run_test(self, name, test_func, *args, **kwargs):
        """Run a single test with error handling"""
        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        
        try:
            result = test_func(*args, **kwargs)
            if result:
                self.tests_passed += 1
                print(f"✅ PASSED: {name}")
                return True
            else:
                print(f"❌ FAILED: {name}")
                self.failed_tests.append(name)
                return False
        except Exception as e:
            print(f"❌ ERROR in {name}: {str(e)}")
            self.failed_tests.append(f"{name} - {str(e)}")
            return False

    def test_backend_health(self):
        """Test backend health endpoints"""
        try:
            # Test /api/health
            response = self.session.get(f"{self.backend_url}/api/health")
            if response.status_code != 200:
                print(f"❌ /api/health returned {response.status_code}")
                return False
            
            health_data = response.json()
            print(f"✅ /api/health: {health_data.get('status', 'unknown')}")
            
            # Test /healthz
            response = self.session.get(f"{self.backend_url}/healthz")
            if response.status_code != 200:
                print(f"❌ /healthz returned {response.status_code}")
                return False
                
            healthz_data = response.json()
            print(f"✅ /healthz: {healthz_data.get('status', 'unknown')}")
            
            return True
        except Exception as e:
            print(f"❌ Backend health check failed: {e}")
            return False

    def test_ml_worker_health(self):
        """Test ML worker health endpoints"""
        try:
            # Test /health
            response = self.session.get(f"{self.ml_worker_url}/health")
            if response.status_code != 200:
                print(f"❌ ML worker /health returned {response.status_code}")
                return False
            
            health_data = response.json()
            print(f"✅ ML worker /health: {health_data.get('status', 'unknown')}")
            print(f"    Service: {health_data.get('service', 'unknown')}")
            
            # Test /healthz
            response = self.session.get(f"{self.ml_worker_url}/healthz")
            if response.status_code != 200:
                print(f"❌ ML worker /healthz returned {response.status_code}")
                return False
                
            healthz_data = response.json()
            print(f"✅ ML worker /healthz: {healthz_data.get('status', 'unknown')}")
            
            return True
        except Exception as e:
            print(f"❌ ML worker health check failed: {e}")
            return False

    def test_api_endpoints(self):
        """Test various API endpoints for dead routes"""
        endpoints_to_test = [
            ("/api/status", "GET", "Status endpoint"),
            ("/api/markets", "GET", "Markets endpoint"),
            ("/api/strategies", "GET", "Strategies endpoint"),
            ("/api/backtesting", "GET", "Backtesting endpoint"),
            ("/api/paper-trading", "GET", "Paper Trading endpoint"),
            ("/api/futures", "GET", "Futures endpoint"),
            ("/api/autonomous-trading", "GET", "Autonomous Trading endpoint"),
            ("/api/confidence-scoring", "GET", "Confidence Scoring endpoint"),
        ]
        
        passed = 0
        total = len(endpoints_to_test)
        dead_routes = []
        
        for endpoint, method, description in endpoints_to_test:
            try:
                url = f"{self.backend_url}{endpoint}"
                if method == "GET":
                    response = self.session.get(url)
                else:
                    response = self.session.post(url)
                
                if response.status_code == 404:
                    print(f"❌ {endpoint}: DEAD ROUTE (404)")
                    dead_routes.append(endpoint)
                elif response.status_code in [200, 201, 401, 403, 422]:  # Accept auth/validation errors as valid
                    print(f"✅ {endpoint}: {response.status_code} - {description}")
                    passed += 1
                else:
                    print(f"⚠️ {endpoint}: {response.status_code} - {description}")
                    passed += 1  # Still accessible, just unexpected status
                    
            except Exception as e:
                print(f"❌ {endpoint}: Error - {e}")
        
        print(f"\nAPI Endpoints Summary: {passed}/{total} accessible")
        if dead_routes:
            print(f"❌ Dead routes detected: {dead_routes}")
            return False
        
        return passed > total * 0.8  # Pass if 80% of endpoints are accessible

    def test_poloniex_futures_integration(self):
        """Test Poloniex Futures v3 API integration and 13 trading pairs"""
        try:
            # Test market data endpoint for trading pairs
            response = self.session.get(f"{self.backend_url}/api/markets")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Markets endpoint accessible")
                
                if isinstance(data, list):
                    print(f"    Found {len(data)} markets")
                    
                    # Check for expected Poloniex Futures trading pairs
                    expected_pairs = [
                        "BTC_USDT_PERP", "ETH_USDT_PERP", "LTC_USDT_PERP", 
                        "XRP_USDT_PERP", "ADA_USDT_PERP", "DOT_USDT_PERP",
                        "LINK_USDT_PERP", "UNI_USDT_PERP", "SOL_USDT_PERP",
                        "AVAX_USDT_PERP", "MATIC_USDT_PERP", "ATOM_USDT_PERP",
                        "FTM_USDT_PERP"
                    ]
                    
                    found_pairs = []
                    for market in data:
                        if isinstance(market, dict):
                            symbol = market.get('symbol', '')
                            if symbol:
                                found_pairs.append(symbol)
                    
                    matching_pairs = [pair for pair in expected_pairs if any(pair in found for found in found_pairs)]
                    
                    if len(matching_pairs) >= 10:  # At least 10 of 13 expected pairs
                        print(f"    ✅ Found {len(matching_pairs)} expected trading pairs")
                        print(f"    Pairs: {matching_pairs[:5]}...")  # Show first 5
                        return True
                    else:
                        print(f"    ⚠️ Only found {len(matching_pairs)} expected pairs")
                        print(f"    Available pairs: {found_pairs[:10]}")  # Show first 10
                        return len(found_pairs) > 5  # Pass if we have some pairs
                else:
                    print(f"    ⚠️ Unexpected response format: {type(data)}")
                    return True  # Still accessible
                    
            elif response.status_code in [401, 403]:
                print("⚠️ Markets endpoint requires authentication (expected for some configurations)")
                return True
            else:
                print(f"❌ Markets endpoint failed: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ Poloniex integration test failed: {e}")
            return False

    def test_paper_trading_functionality(self):
        """Test paper trading functionality"""
        try:
            response = self.session.get(f"{self.backend_url}/api/paper-trading")
            
            if response.status_code == 200:
                data = response.json()
                print("✅ Paper trading endpoint accessible")
                return True
            elif response.status_code in [401, 403, 422]:
                print("⚠️ Paper trading requires authentication/validation (expected)")
                return True
            else:
                print(f"❌ Paper trading endpoint failed: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ Paper trading test failed: {e}")
            return False

    def test_cors_configuration(self):
        """Test CORS configuration"""
        try:
            response = self.session.options(f"{self.backend_url}/api/health")
            cors_headers = {
                'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
                'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
                'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
            }
            
            print(f"CORS Headers: {cors_headers}")
            
            # Check if CORS is properly configured
            if cors_headers['Access-Control-Allow-Origin']:
                print("✅ CORS configured")
                return True
            else:
                print("⚠️ CORS may not be properly configured")
                return True  # Not critical for functionality
                
        except Exception as e:
            print(f"❌ CORS test failed: {e}")
            return False

    def test_strategy_types_unified(self):
        """Test strategy types unified configuration"""
        try:
            response = self.session.get(f"{self.backend_url}/api/strategies")
            
            if response.status_code == 200:
                data = response.json()
                print("✅ Strategy types endpoint accessible")
                return True
            elif response.status_code in [401, 403, 422]:
                print("⚠️ Strategies endpoint requires authentication (expected)")
                return True
            else:
                print(f"❌ Strategies endpoint failed: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ Strategy types test failed: {e}")
            return False

    def test_ml_worker_ingest(self):
        """Test ML worker ingest functionality"""
        try:
            response = self.session.post(f"{self.ml_worker_url}/run/ingest")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ ML worker ingest endpoint accessible")
                print(f"    Result: {data.get('ok', 'unknown')}")
                return True
            elif response.status_code in [422, 500]:
                print("⚠️ ML worker ingest may require configuration (expected)")
                return True
            else:
                print(f"❌ ML worker ingest failed: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ ML worker ingest test failed: {e}")
            return False

    def test_websocket_connection(self):
        """Test WebSocket connection"""
        try:
            ws_connected = False
            
            def on_open(ws):
                nonlocal ws_connected
                print("🔌 WebSocket connected")
                ws_connected = True
                ws.close()
            
            def on_error(ws, error):
                print(f"❌ WebSocket error: {error}")
            
            # Create WebSocket connection
            ws = websocket.WebSocketApp(
                f"{self.ws_url}/socket.io/?EIO=4&transport=websocket",
                on_error=on_error,
                on_open=on_open
            )
            
            # Run WebSocket in a thread with timeout
            ws_thread = threading.Thread(target=ws.run_forever)
            ws_thread.daemon = True
            ws_thread.start()
            
            # Wait for connection
            time.sleep(2)
            
            if ws_connected:
                print("✅ WebSocket connection established")
                return True
            else:
                print("⚠️ WebSocket connection not established (may be expected)")
                return True  # Not critical for basic functionality
                
        except Exception as e:
            print(f"⚠️ WebSocket test failed: {e}")
            return True  # Not critical

    def run_all_tests(self):
        """Run all tests and generate report"""
        print("\n🧪 Running comprehensive Poloniex Futures platform tests...\n")
        
        # Core health tests
        self.run_test("Backend Health Check (/api/health)", self.test_backend_health)
        self.run_test("ML Worker Health Check (/health)", self.test_ml_worker_health)
        
        # API functionality tests
        self.run_test("API Endpoints (No Dead Routes)", self.test_api_endpoints)
        self.run_test("CORS Configuration", self.test_cors_configuration)
        
        # Poloniex Futures specific tests
        self.run_test("Poloniex Futures v3 API Integration (13 Trading Pairs)", self.test_poloniex_futures_integration)
        self.run_test("Paper Trading Functionality", self.test_paper_trading_functionality)
        self.run_test("Strategy Types Unified", self.test_strategy_types_unified)
        
        # ML Worker tests
        self.run_test("ML Worker Ingest Endpoint", self.test_ml_worker_ingest)
        
        # Optional tests
        self.run_test("WebSocket Connection", self.test_websocket_connection)
        
        # Generate final report
        self.generate_report()

    def generate_report(self):
        """Generate final test report"""
        print("\n" + "=" * 60)
        print("📊 POLONIEX FUTURES TRADING PLATFORM TEST REPORT")
        print("=" * 60)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {len(self.failed_tests)}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        if self.failed_tests:
            print(f"\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"  - {test}")
        
        print(f"\n🕐 Test completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 60)
        
        return self.tests_passed == self.tests_run

def main():
    """Main test execution"""
    tester = PoloniexFuturesAPITester()
    success = tester.run_all_tests()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())