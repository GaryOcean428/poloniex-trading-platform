// React is used implicitly for JSX transformation
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Strategies from './pages/Strategies';
import Account from './pages/Account';
import MarketAnalysis from './pages/MarketAnalysis';
import Performance from './pages/Performance';
import Settings from './pages/Settings';
import ExtensionDownload from './pages/ExtensionDownload';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import EnvironmentStatus from './components/EnvironmentStatus';
import ConnectionHealth from './components/ConnectionHealth';
import { TradingProvider } from './context/TradingContext';
import { SettingsProvider } from './context/SettingsContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Integration from './components/Integration';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <SettingsProvider>
          <WebSocketProvider>
            <TradingProvider>
              <div className="flex h-screen bg-neutral-100">
                <Sidebar />
                <div className="flex-1 flex flex-col overflow-hidden">
                  <Navbar />
                  <main className="flex-1 overflow-x-hidden overflow-y-auto bg-neutral-100 p-4">
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/strategies" element={<Strategies />} />
                      <Route path="/charts" element={<MarketAnalysis />} />
                      <Route path="/performance" element={<Performance />} />
                      <Route path="/account" element={<Account />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/extension" element={<ExtensionDownload />} />
                    </Routes>
                  </main>
                </div>
              </div>
              <Integration />
              <EnvironmentStatus />
              <ConnectionHealth />
            </TradingProvider>
          </WebSocketProvider>
        </SettingsProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App
