import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Login from '../components/auth/Login';

const LoginPage: React.FC = () => {
  const { isLoggedIn, loading } = useAuth();

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Redirect if already logged in
  if (isLoggedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to Poloniex Trading
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to access your trading dashboard
          </p>
        </div>
        
        <Login 
          onSuccess={() => {
            // Navigation will be handled by the redirect logic above
            window.location.reload();
          }} 
        />
        
        <div className="text-center">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <button className="font-medium text-blue-600 hover:text-blue-500">
              Contact us for access
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
