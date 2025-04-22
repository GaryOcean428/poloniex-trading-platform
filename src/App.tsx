// React is used implicitly for JSX transformation
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Strategies from './pages/Strategies';
import Account from './pages/Account';
import MarketAnalysis from './pages/MarketAnalysis';
import Settings from './pages/Settings';
import ExtensionDownload from './pages/ExtensionDownload';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import { TradingProvider } from './context/TradingContext';
import { SettingsProvider } from './context/SettingsContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Integration from './components/Integration';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <SettingsProvider>
          <TradingProvider>
            <div className="flex h-screen bg-gray-100">
              <Sidebar />
              <div className="flex-1 flex flex-col overflow-hidden">
                <Navbar />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-4">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/strategies" element={<Strategies />} />
                    <Route path="/charts" element={<MarketAnalysis />} />
                    <Route path="/account" element={<Account />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/extension" element={<ExtensionDownload />} />
                  </Routes>
                </main>
              </div>
            </div>
            <Integration />
          </TradingProvider>
        </SettingsProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App
