import { logger } from '@/services/logger';
import React, { useEffect, useState } from 'react';

// Extend the Window interface to include PWA-related properties
declare global {
  interface Window {
    deferredPrompt?: BeforeInstallPromptEvent;
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
}

// Type for installed related apps
interface InstalledApp {
  id: string;
  url: string;
  platform: string;
}

interface PWAInstallPromptProps {
  onInstall?: () => void;
  onDismiss?: () => void;
}

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  onInstall,
  onDismiss
}) => {
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState<boolean>(false);

  useEffect(() => {
    // Check if app is running in standalone mode
    const checkStandaloneMode = () => {
      const nav = (typeof window !== 'undefined' ? window.navigator : undefined) as (Navigator & { standalone?: boolean }) | undefined;

      const isStandaloneMatchMedia = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(display-mode: standalone)').matches;

      const isNavigatorStandalone = Boolean(nav && (nav as any).standalone === true);

      const isAndroidReferrer = typeof document !== 'undefined'
        && typeof document.referrer === 'string'
        && document.referrer.includes('android-app://');

      const standalone = Boolean(isStandaloneMatchMedia || isNavigatorStandalone || isAndroidReferrer);

      setIsStandalone(standalone);
      logger.info('Standalone mode checked', {
        component: 'PWAInstallPrompt',
        metadata: { standalone }
      });
    };

    checkStandaloneMode();

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();

      // Respect prior dismissal and standalone state to avoid noisy warnings
      const dismissed = (() => {
        try {
          return localStorage.getItem('pwa_install_dismissed') === 'true';
        } catch {
          return false;
        }
      })();
      if (dismissed || isStandalone) {
        return;
      }

      // Type assertion for the beforeinstallprompt event
      const beforeInstallEvent = e as unknown as BeforeInstallPromptEvent;
      setDeferredPrompt(beforeInstallEvent);
      setShowPrompt(true);
      logger.info('PWA install prompt available', {
        component: 'PWAInstallPrompt'
      });
    };

    // Hide banner and clear deferred prompt when app is installed via browser UI
    const handleAppInstalled = () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
      logger.info('PWA installed', {
        component: 'PWAInstallPrompt'
      });
      onInstall?.();
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.addEventListener('appinstalled', handleAppInstalled);
    }

    // Check if already installed (with type assertion for getInstalledRelatedApps)
    const nav = window.navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<InstalledApp[]>;
    };

    if (nav.getInstalledRelatedApps) {
      nav.getInstalledRelatedApps().then((apps: InstalledApp[]) => {
        if (apps.length > 0)
        {
          logger.info('PWA already installed', {
            component: 'PWAInstallPrompt',
            metadata: { appsCount: apps.length }
          });
          setShowPrompt(false);
        }
      });
    }

    return () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.removeEventListener('appinstalled', handleAppInstalled);
      }
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      // Use the properly typed deferredPrompt
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      logger.info('User response to install prompt', {
        component: 'PWAInstallPrompt',
        metadata: { outcome }
      });

      if (outcome === 'accepted')
      {
        setShowPrompt(false);
        onInstall?.();
      }

      setDeferredPrompt(null);
    } catch (error)
    {
      logger.error('Error installing PWA', {
        component: 'PWAInstallPrompt',
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      localStorage.setItem('pwa_install_dismissed', 'true');
    } catch {
      // no-op if storage unavailable
    }
    onDismiss?.();
  };

  if (isStandalone || !showPrompt)
  {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white shadow-lg rounded-lg p-4 max-w-sm z-50 border border-neutral-200">
      <div className="flex items-start justify-between">
        <div className="flex items-center">
          <img
            src="/icon-192.png"
            alt="Trading Bot"
            className="w-8 h-8 mr-3"
          />
          <div>
            <h3 className="text-sm font-semibold">Install Trading Bot</h3>
            <p className="text-xs text-neutral-600 mt-1">
              Get better performance and offline access
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-neutral-400 hover:text-neutral-600"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <div className="mt-3 flex space-x-2">
        <button
          onClick={handleInstall}
          className="flex-1 bg-blue-600 text-white text-sm py-2 px-3 rounded-md hover:bg-blue-700 transition-colors"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="flex-1 bg-neutral-100 text-neutral-700 text-sm py-2 px-3 rounded-md hover:bg-neutral-200 transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
