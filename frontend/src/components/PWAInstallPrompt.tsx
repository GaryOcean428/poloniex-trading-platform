import React, { useEffect, useState } from 'react';

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

interface PWAInstallPromptProps {
  onInstall?: () => void;
  onDismiss?: () => void;
}

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  onInstall,
  onDismiss
}) => {
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [showPrompt, setShowPrompt] = useState<boolean>(false);

  useEffect(() => {
    // Check if app is running in standalone mode
    const checkStandaloneMode = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone ||
        document.referrer.includes('android-app://');

      setIsStandalone(standalone);
      console.log('Standalone mode:', standalone);
    };

    checkStandaloneMode();

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
      console.log('PWA install prompt available');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Check if already installed
    if ((window.navigator as any).getInstalledRelatedApps)
    {
      (window.navigator as any).getInstalledRelatedApps().then((apps: any[]) => {
        if (apps.length > 0)
        {
          console.log('PWA already installed');
          setShowPrompt(false);
        }
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try
    {
      // Cast to any for PWA-specific properties
      const prompt = deferredPrompt as any;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;

      console.log(`User response to install prompt: ${outcome}`);

      if (outcome === 'accepted')
      {
        setShowPrompt(false);
        onInstall?.();
      }

      setDeferredPrompt(null);
    } catch (error)
    {
      console.error('Error installing PWA:', error);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
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
