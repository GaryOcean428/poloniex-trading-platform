import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import SkipLinks from './components/SkipLinks';
import ConnectionHealth from './components/ConnectionHealth';

import { EnvDebug } from './components/EnvDebug';
import { ConnectionTest } from './components/ConnectionTest';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import { TradingProvider } from './context/TradingContext';
import { SettingsProvider } from './context/SettingsContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { AuthProvider } from './context/AuthContext';
import { MobileMenuProvider } from './context/MobileMenuContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Integration from './components/Integration';
import ToastContainer from './components/ToastContainer';
import RouteGuard from './components/RouteGuard';
import { BrowserCompatibility } from './utils/extensionErrorHandler';
import './styles/theme.css';
import './App.css';

// Lazy load page components
const Dashboard = lazy(() => import('./pages/Dashboard'));
const LiveTradingDashboard = lazy(() => import('./pages/LiveTradingDashboard'));
const Strategies = lazy(() => import('./pages/Strategies'));
const Backtesting = lazy(() => import('./pages/Backtesting'));
const Account = lazy(() => import('./pages/Account'));
const TransactionHistory = lazy(() => import('./pages/TransactionHistory'));
const TradeHistory = lazy(() => import('./pages/TradeHistory'));
const MarketAnalysis = lazy(() => import('./pages/MarketAnalysis'));
const Performance = lazy(() => import('./pages/Performance'));
const Settings = lazy(() => import('./pages/Settings'));
const Chat = lazy(() => import('./pages/Chat'));
const ExtensionDownload = lazy(() => import('./pages/ExtensionDownload'));
const AIStrategyGenerator = lazy(() => import('./pages/AIStrategyGenerator'));
const StrategyDashboard = lazy(() => import('./pages/StrategyDashboard')); // AI strategy visualization
const AutonomousAgent = lazy(() => import('./pages/AutonomousAgent')); // AI-powered autonomous trading
const Status = lazy(() => import('./pages/Status'));
const Login = lazy(() => import('./pages/Login'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Loading component
const LoadingSpinner = () => (
  <div 
    className="flex items-center justify-center min-h-screen"
    role="status"
    aria-label="Loading application"
  >
    <div 
      className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"
      aria-hidden="true"
    ></div>
    <span className="sr-only">Loading...</span>
  </div>
);

function App() {
  useEffect(() => {
    BrowserCompatibility.setupExtensionCompatibility();
    
    const darkMode = (window as any).useAppStore?.getState?.()?.ui?.darkMode;
    if (darkMode) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <>
      <SkipLinks />
      <Router>
        <ErrorBoundary>
          <AuthProvider>
            <SettingsProvider>
              <WebSocketProvider>
                <TradingProvider>
                <MobileMenuProvider>
                <div className="flex h-screen bg-neutral-100 overflow-hidden">
                  <Sidebar />
                  <div className="flex-1 flex flex-col min-w-0">
                    <Navbar />
                    <main 
                      id="main-content"
                      className="flex-1 overflow-y-auto bg-neutral-100 p-4 sm:p-6 lg:p-8"
                      role="main"
                      aria-label="Main content"
                      tabIndex={-1}
                    >
                      <RouteGuard>
                        <Suspense fallback={<LoadingSpinner />}>
                          <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/dashboard/live" element={<LiveTradingDashboard />} />
                            <Route path="/strategies" element={<Strategies />} />
                            <Route path="/ai-strategies" element={<AIStrategyGenerator />} />
                            <Route path="/strategy-dashboard" element={<StrategyDashboard />} />
                            <Route path="/autonomous-agent" element={<AutonomousAgent />} />
                            <Route path="/backtesting" element={<Backtesting />} />
                            <Route path="/charts" element={<MarketAnalysis />} />
                            <Route path="/performance" element={<Performance />} />
                            <Route path="/account" element={<Account />} />
                            <Route path="/transactions" element={<TransactionHistory />} />
                            <Route path="/trades" element={<TradeHistory />} />
                            <Route path="/chat" element={<Chat />} />
                            <Route path="/settings" element={<Settings />} />
                            <Route path="/extension" element={<ExtensionDownload />} />
                            <Route path="/status" element={<Status />} />
                            <Route path="/login" element={<Login />} />
                            <Route path="/404" element={<NotFound />} />
                            <Route path="*" element={<NotFound />} />
                          </Routes>
                        </Suspense>
                      </RouteGuard>
                    </main>
                  </div>
                </div>
                <Integration />
                <ToastContainer />

                {/* Debug components - only in development */}
                {import.meta.env.DEV && (
                  <>
                    <ConnectionHealth />
                    <EnvDebug />
                    <ConnectionTest />
                  </>
                )}
                <PWAInstallPrompt />
                </MobileMenuProvider>
                </TradingProvider>
              </WebSocketProvider>
            </SettingsProvider>
          </AuthProvider>
        </ErrorBoundary>
      </Router>
    </>
  );
}

export default App;
// Force rebuild Thu Nov  6 01:20:18 EST 2025
