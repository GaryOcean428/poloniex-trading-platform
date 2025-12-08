import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * ProtectedRoute component to handle authentication-based routing
 * 
 * @param children - The components to render if authentication check passes
 * @param requireAuth - Whether authentication is required (default: true)
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requireAuth = true 
}) => {
  const { isLoggedIn } = useAuth();
  const location = useLocation();

  // If authentication is required but user is not logged in, redirect to login
  if (requireAuth && !isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If authentication is not required but user is logged in, redirect to dashboard
  if (!requireAuth && isLoggedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  // Render children if authentication check passes
  return <>{children}</>;
};

export default ProtectedRoute;
