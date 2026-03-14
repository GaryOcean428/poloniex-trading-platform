import React, { useState, lazy, Suspense } from 'react';
import { History as HistoryIcon, Receipt, BarChart3 } from 'lucide-react';

const TransactionHistory = lazy(() => import('./TransactionHistory'));
const TradeHistory = lazy(() => import('./TradeHistory'));

type HistoryTab = 'trades' | 'transactions';

const History: React.FC = () => {
  const [activeTab, setActiveTab] = useState<HistoryTab>('trades');

  const tabs: { id: HistoryTab; label: string; icon: React.ReactNode }[] = [
    { id: 'trades', label: 'Trade History', icon: <BarChart3 size={18} /> },
    { id: 'transactions', label: 'Transaction History', icon: <Receipt size={18} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3 mb-2">
        <HistoryIcon className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">History</h1>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-4" aria-label="History tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }
              `}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <Suspense fallback={
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      }>
        {activeTab === 'trades' && <TradeHistory />}
        {activeTab === 'transactions' && <TransactionHistory />}
      </Suspense>
    </div>
  );
};

export default History;
