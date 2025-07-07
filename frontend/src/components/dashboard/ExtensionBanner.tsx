import React from 'react';
import { Chrome, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const ExtensionBanner: React.FC = () => {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-lg shadow-md p-4 text-white">
      <div className="flex flex-col md:flex-row items-center justify-between">
        <div className="flex items-center mb-4 md:mb-0">
          <Chrome className="h-10 w-10 mr-4" />
          <div>
            <h3 className="text-lg font-bold">Get our Chrome Extension</h3>
            <p className="text-blue-100">Trade from anywhere in your browser</p>
          </div>
        </div>
        <Link 
          to="/extension" 
          className="bg-white text-blue-700 hover:bg-blue-50 font-medium py-2 px-4 rounded-md flex items-center"
        >
          Download Now
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </div>
    </div>
  );
};

export default ExtensionBanner;