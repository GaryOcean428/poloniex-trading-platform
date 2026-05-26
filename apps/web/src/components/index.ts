// Main Components Index
// Barrel file for all components - use this for consolidated imports
// import { Navbar, ErrorBoundary } from '@/components';

// Re-export feature-based components
export * from './auth';
export * from './dashboard';
export * from './ui';

// Top-level components (default exports)
export { default as APIErrorBoundary } from './APIErrorBoundary';
export { default as AccessibleButton } from './AccessibleButton';
export { default as ConnectionHealth } from './ConnectionHealth';
export { default as MobileNavigation } from './MobileNavigation';
export { default as Navbar } from './Navbar';
export { default as NotificationPanel } from './NotificationPanel';
export { default as PWAInstallPrompt } from './PWAInstallPrompt';
export { default as ResponsiveContainer } from './ResponsiveContainer';

// Top-level components (named exports)
export { AccessibleInput, AccessibleSelect, AccessibleTextarea } from './AccessibleForm';
export { ConnectionTest } from './ConnectionTest';
export { EnvDebug } from './EnvDebug';
export { ErrorBoundary } from './ErrorBoundary';
export { ErrorFallback } from './ErrorFallback';
