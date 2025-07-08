import { useContext } from 'react';
import { MockModeContext } from '../context/MockModeContext';

export const useMockMode = () => {
  const context = useContext(MockModeContext);
  if (context === undefined) {
    throw new Error('useMockMode must be used within a MockModeProvider');
  }
  return context;
};