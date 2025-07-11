import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    // Check if already dismissed
    const dismissed = localStorage.getItem('pwa_install_dismissed') === 'true';
    
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isInWebAppiOS = (window.navigator as any).standalone === true;
    const isInstalled = isStandalone || isInWebAppiOS;

    if (dismissed || isInstalled) {
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      setIsInstallable(true);
      
      // Show our custom prompt after a short delay
      setTimeout(() => {
        setShowPrompt(true);
      }, 5000); // Show after 5 seconds
    };

    const handleAppInstalled = () => {
      console.log('PWA: App was installed');
      setShowPrompt(false);
      setDeferredPrompt(null);
      setIsInstallable(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      
      if (choiceResult.outcome === 'accepted') {
        console.log('PWA: User accepted the install prompt');
      } else {
        console.log('PWA: User dismissed the install prompt');
      }
      
      setDeferredPrompt(null);
      setShowPrompt(false);
    } catch (error) {
      console.error('PWA: Error during installation:', error);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa_install_dismissed', 'true');
  };

  if (!showPrompt || !isInstallable) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 animate-in slide-in-from-bottom duration-300">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <Download className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-gray-900">
              Install Poloniex Trading
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Add to your home screen for quick access and offline support
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      <div className="mt-3 flex space-x-2">
        <button
          onClick={handleInstallClick}
          className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 px-3 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium py-2 px-3 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;