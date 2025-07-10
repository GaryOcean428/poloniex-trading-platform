import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Home, ArrowLeft } from 'lucide-react';

const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md mx-auto px-6">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
        
        <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
        
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">
          Page Not Found
        </h2>
        
        <p className="text-gray-600 mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        
        <div className="space-y-4">
          <Link
            to="/"
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Home className="w-5 h-5 mr-2" />
            Go to Dashboard
          </Link>
          
          <div className="mt-4">
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </button>
          </div>
        </div>
        
        <div className="mt-8 text-sm text-gray-500">
          <p>Available pages:</p>
          <div className="mt-2 space-x-4">
            <Link to="/" className="text-blue-600 hover:underline">Dashboard</Link>
            <Link to="/strategies" className="text-blue-600 hover:underline">Strategies</Link>
            <Link to="/account" className="text-blue-600 hover:underline">Account</Link>
            <Link to="/settings" className="text-blue-600 hover:underline">Settings</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;