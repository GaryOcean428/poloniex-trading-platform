// Main Components Index
// Barrel file for all components - use this for consolidated imports
// import { Navbar, ErrorBoundary } from '@/components';

// Re-export feature-based components
export * from './auth';
export * from './dashboard';
export * from './trading';
export * from './ui';

// Top-level components
export { default as APIErrorBoundary } from './APIErrorBoundary';
export { default as AccessibleButton } from './AccessibleButton';
export { default as AccessibleForm } from './AccessibleForm';
export { default as AccessibleModal } from './AccessibleModal';
export { default as AccountBalanceDisplay } from './AccountBalanceDisplay';
export { default as AgentSettings } from './AgentSettings';
export { default as ConfigurationStatus } from './ConfigurationStatus';
export { default as ConnectionHealth } from './ConnectionHealth';
export { default as ConnectionStatus } from './ConnectionStatus';
export { default as ConnectionTest } from './ConnectionTest';
export { default as EnvDebug } from './EnvDebug';
export { default as EnvironmentStatus } from './EnvironmentStatus';
export { default as ErrorAlert } from './ErrorAlert';
export { default as ErrorBoundary } from './ErrorBoundary';
export { default as ErrorFallback } from './ErrorFallback';
export { default as Integration } from './Integration';
export { default as MobileNavigation } from './MobileNavigation';
export { default as MockModeNotice } from './MockModeNotice';
export { default as Navbar } from './Navbar';
export { default as NotificationPanel } from './NotificationPanel';
export { default as PWAInstallPrompt } from './PWAInstallPrompt';
export { default as QIGMetricsPanel } from './QIGMetricsPanel';
export { default as QIGPredictionCard } from './QIGPredictionCard';
export { default as ResponsiveContainer } from './ResponsiveContainer';
export { default as ResponsiveTable } from './ResponsiveTable';
