import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface RouteGuardProps {
  children: React.ReactNode;
}

// Component to preserve navigation state and handle route transitions
const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Add navigation state preservation logic here
    // For now, we'll just log the route change in development
    if (import.meta.env.DEV) {
      console.info('Route changed to:', location.pathname);
    }
    
    // Store current path in session storage for state preservation
    sessionStorage.setItem('lastRoute', location.pathname);
    
    // Add route validation if needed
    const validRoutes = [
      '/', 
      '/strategies', 
      '/ai-strategies',
      '/backtesting',
      '/charts', 
      '/performance', 
      '/account', 
      '/transactions',
      '/trades',
      '/chat', 
      '/settings', 
      '/extension',
      '/status',
      '/login',
      '/dashboard/live',
      '/404'
    ];
    
    // If route is not valid and not already a 404, redirect to 404
    if (!validRoutes.includes(location.pathname) && location.pathname !== '/404') {
      navigate('/404', { replace: true });
    }
  }, [location.pathname, navigate]);

  return <>{children}</>;
};

export default RouteGuard;
