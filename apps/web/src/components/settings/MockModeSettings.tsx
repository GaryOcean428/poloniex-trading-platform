import React from 'react';

/**
 * MockModeSettings - Disabled
 * This component has been disabled as the platform now uses real data exclusively.
 * Mock mode is no longer supported. Keeping for backwards compatibility.
 */
const MockModeSettings: React.FC = () => {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 text-neutral-800 dark:text-white">Live Data Mode</h2>
      <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-4">
        <p className="text-sm text-green-700 dark:text-green-300">
          <span className="font-medium">Real Data Active:</span> This platform now uses live market data from Poloniex exclusively. Mock mode has been disabled.
        </p>
      </div>
    </div>
  );
};

export default MockModeSettings;
