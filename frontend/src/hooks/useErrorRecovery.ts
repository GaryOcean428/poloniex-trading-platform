import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const useErrorRecovery = (hasError: boolean, error: Error | null) => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);
  
  useEffect(() => {
    if (!hasError) return;
    
    // Check if error is related to routing/navigation
    const isRoutingError = error?.message?.includes('Failed to load') || 
                          error?.message?.includes('chunk') ||
                          error?.message?.includes('route');
    
    // Start countdown for auto-navigation to dashboard
    if (isRoutingError) {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            navigate('/dashboard');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [hasError, error, navigate]);
  
  const navigateToDashboard = () => {
    navigate('/dashboard');
  };
  
  return { countdown, navigateToDashboard };
};