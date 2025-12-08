import React from 'react';
import { Chrome, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const ExtensionBanner: React.FC = () => {
  return (
    <div className="gradient-primary rounded-lg shadow-elev-3 p-6 text-text-inverse">
      <div className="flex flex-col md:flex-row items-center justify-between">
        <div className="flex items-center mb-4 md:mb-0">
          <Chrome className="h-10 w-10 mr-4" />
          <div>
            <h3 className="text-xl font-bold">Get our Chrome Extension</h3>
            <p className="text-text-inverse opacity-90">Trade from anywhere in your browser</p>
          </div>
        </div>
        <Link 
          to="/extension" 
          className="bg-bg-elevated text-brand-cyan hover:bg-bg-tertiary font-semibold py-2.5 px-6 rounded-lg flex items-center transition-all duration-200 hover:shadow-elev-2"
        >
          Download Now
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </div>
    </div>
  );
};

export default ExtensionBanner;
