// React is used implicitly for JSX transformation
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import SkipLinks from './components/SkipLinks';
import EnvironmentStatus from './components/EnvironmentStatus';
import ConnectionHealth from './components/ConnectionHealth';
import { ConfigurationStatus } from './components/ConfigurationStatus';
import { EnvDebug } from './components/EnvDebug';
import { ConnectionTest } from './components/ConnectionTest';
import { TradingProvider } from './context/TradingContext';
import { SettingsProvider } from './context/SettingsContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Integration from './components/Integration';
import { BrowserCompatibility } from './utils/extensionErrorHandler';
import './App.css';

// Lazy load page components
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Strategies = lazy(() => import('./pages/Strategies'));
const Account = lazy(() => import('./pages/Account'));
const MarketAnalysis = lazy(() => import('./pages/MarketAnalysis'));
const Performance = lazy(() => import('./pages/Performance'));
const Settings = lazy(() => import('./pages/Settings'));
const ExtensionDownload = lazy(() => import('./pages/ExtensionDownload'));

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
  // Initialize browser compatibility and extension error handling after React mounts
  useEffect(() => {
    BrowserCompatibility.setupExtensionCompatibility();
  }, []);
  return (
    <>
      <SkipLinks />
      <Router>
        <ErrorBoundary>
          <SettingsProvider>
            <WebSocketProvider>
              <TradingProvider>
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
                      <Suspense fallback={<LoadingSpinner />}>
                        <Routes>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/strategies" element={<Strategies />} />
                          <Route path="/charts" element={<MarketAnalysis />} />
                          <Route path="/performance" element={<Performance />} />
                          <Route path="/account" element={<Account />} />
                          <Route path="/settings" element={<Settings />} />
                          <Route path="/extension" element={<ExtensionDownload />} />
                        </Routes>
                      </Suspense>
                    </main>
                  </div>
                </div>
                <Integration />
                <EnvironmentStatus />
                <ConfigurationStatus />
                <ConnectionHealth />
                <EnvDebug />
                <ConnectionTest />
              </TradingProvider>
            </WebSocketProvider>
          </SettingsProvider>
        </ErrorBoundary>
      </Router>
    </>
  );
}

export default App;
