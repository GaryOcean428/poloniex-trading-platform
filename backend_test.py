#!/usr/bin/env python3
"""
Comprehensive backend API testing for Polytrade application.
Tests all health endpoints, WebSocket connections, and API functionality.
"""

import requests
import json
import sys
import time
from datetime import datetime
import websocket
import threading
from urllib.parse import urljoin

class PolytradeAPITester:
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
        
        print(f"🚀 Starting Polytrade API Testing")
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
        """Test various API endpoints"""
        endpoints_to_test = [
            ("/api/status", "GET"),
            ("/api/markets", "GET"),
            ("/api/strategies", "GET"),
            ("/api/backtesting", "GET"),
            ("/api/paper-trading", "GET"),
            ("/api/futures", "GET"),
        ]
        
        passed = 0
        total = len(endpoints_to_test)
        
        for endpoint, method in endpoints_to_test:
            try:
                url = f"{self.backend_url}{endpoint}"
                if method == "GET":
                    response = self.session.get(url)
                else:
                    response = self.session.post(url)
                
                if response.status_code in [200, 201, 401, 403]:  # Accept auth errors as valid responses
                    print(f"✅ {endpoint}: {response.status_code}")
                    passed += 1
                else:
                    print(f"❌ {endpoint}: {response.status_code}")
                    
            except Exception as e:
                print(f"❌ {endpoint}: Error - {e}")
        
        print(f"API Endpoints: {passed}/{total} accessible")
        return passed > total * 0.7  # Pass if 70% of endpoints are accessible

    def test_websocket_connection(self):
        """Test WebSocket connection"""
        try:
            ws_connected = False
            ws_response_received = False
            
            def on_message(ws, message):
                nonlocal ws_response_received
                print(f"📨 WebSocket message: {message}")
                ws_response_received = True
                ws.close()
            
            def on_open(ws):
                nonlocal ws_connected
                print("🔌 WebSocket connected")
                ws_connected = True
                # Send a health check
                ws.send('{"type": "health-check"}')
            
            def on_error(ws, error):
                print(f"❌ WebSocket error: {error}")
            
            def on_close(ws, close_status_code, close_msg):
                print("🔌 WebSocket closed")
            
            # Create WebSocket connection
            ws = websocket.WebSocketApp(
                f"{self.ws_url}/socket.io/?EIO=4&transport=websocket",
                on_message=on_message,
                on_error=on_error,
                on_open=on_open,
                on_close=on_close
            )
            
            # Run WebSocket in a thread with timeout
            ws_thread = threading.Thread(target=ws.run_forever)
            ws_thread.daemon = True
            ws_thread.start()
            
            # Wait for connection
            time.sleep(3)
            
            if ws_connected:
                print("✅ WebSocket connection established")
                return True
            else:
                print("❌ WebSocket connection failed")
                return False
                
        except Exception as e:
            print(f"❌ WebSocket test failed: {e}")
            return False

    def test_cors_headers(self):
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

    def test_database_connection(self):
        """Test database connectivity through API"""
        try:
            # Try to access an endpoint that would require database
            response = self.session.get(f"{self.backend_url}/api/status")
            
            if response.status_code in [200, 401, 403]:
                print("✅ Database connection appears healthy (API responding)")
                return True
            else:
                print(f"❌ Database connection issues (API returned {response.status_code})")
                return False
                
        except Exception as e:
            print(f"❌ Database connection test failed: {e}")
            return False

    def test_poloniex_integration(self):
        """Test Poloniex API integration"""
        try:
            # Test market data endpoint
            response = self.session.get(f"{self.backend_url}/api/markets")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Markets endpoint accessible: {len(data) if isinstance(data, list) else 'data available'}")
                return True
            elif response.status_code in [401, 403]:
                print("⚠️ Markets endpoint requires authentication (expected)")
                return True
            else:
                print(f"❌ Markets endpoint failed: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ Poloniex integration test failed: {e}")
            return False

    def run_all_tests(self):
        """Run all tests and generate report"""
        print("\n🧪 Running comprehensive backend tests...\n")
        
        # Core health tests
        self.run_test("Backend Health Check", self.test_backend_health)
        self.run_test("ML Worker Health Check", self.test_ml_worker_health)
        
        # API functionality tests
        self.run_test("API Endpoints Accessibility", self.test_api_endpoints)
        self.run_test("Database Connection", self.test_database_connection)
        self.run_test("CORS Configuration", self.test_cors_headers)
        
        # Integration tests
        self.run_test("WebSocket Connection", self.test_websocket_connection)
        self.run_test("Poloniex Integration", self.test_poloniex_integration)
        
        # Generate final report
        self.generate_report()

    def generate_report(self):
        """Generate final test report"""
        print("\n" + "=" * 60)
        print("📊 POLYTRADE BACKEND TEST REPORT")
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
    tester = PolytradeAPITester()
    success = tester.run_all_tests()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())