import React from 'react';
import { SettingsProvider } from './SettingsContext';
import { MockModeProvider } from './MockModeContext';
import { AuthProvider } from './AuthContext';
import { TradingProvider } from './TradingContext';
import { FuturesProvider } from './FuturesContext';

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * Combined providers for the application
 * This ensures proper nesting order and dependencies between contexts
 */
export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <SettingsProvider>
      <MockModeProvider>
        <AuthProvider>
          <TradingProvider>
            <FuturesProvider>
              {children}
            </FuturesProvider>
          </TradingProvider>
        </AuthProvider>
      </MockModeProvider>
    </SettingsProvider>
  );
};

export default AppProviders;
