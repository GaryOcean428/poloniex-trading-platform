import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Home, ArrowLeft } from 'lucide-react';

const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
      <div className="text-center max-w-md mx-auto px-6">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
        
        <h1 className="text-6xl font-bold text-text-primary mb-4">404</h1>
        
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Page Not Found
        </h2>
        
        <p className="text-text-secondary mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        
        <div className="space-y-4">
          <Link
            to="/"
            className="inline-flex items-center px-6 py-3 bg-brand-cyan text-white rounded-lg hover:bg-brand-cyan/90 transition-colors shadow-elev-1 hover:shadow-elev-2"
          >
            <Home className="w-5 h-5 mr-2" />
            Go to Dashboard
          </Link>
          
          <div className="mt-4">
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </button>
          </div>
        </div>
        
        <div className="mt-8 text-sm text-text-muted">
          <p>Available pages:</p>
          <div className="mt-2 space-x-4">
            <Link to="/" className="text-brand-cyan hover:underline">Dashboard</Link>
            <Link to="/strategies" className="text-brand-cyan hover:underline">Strategies</Link>
            <Link to="/account" className="text-brand-cyan hover:underline">Account</Link>
            <Link to="/settings" className="text-brand-cyan hover:underline">Settings</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
