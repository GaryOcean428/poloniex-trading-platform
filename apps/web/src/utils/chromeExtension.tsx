import React from 'react';
import { FuturesProvider } from '@/context/FuturesContext';
import { AuthProvider } from '@/context/AuthContext';
import { SettingsProvider } from '@/context/SettingsContext';

// Root provider component that wraps the application with all necessary context providers
interface AppProvidersProps {
  children: React.ReactNode;
}

const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <AuthProvider>
      <SettingsProvider>
        <FuturesProvider>
          {children}
        </FuturesProvider>
      </SettingsProvider>
    </AuthProvider>
  );
};

export default AppProviders;
