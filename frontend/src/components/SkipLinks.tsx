import React from 'react';

const SkipLinks: React.FC = () => {
  return (
    <div className="sr-only-focusable">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#navigation" className="skip-link">
        Skip to navigation
      </a>
    </div>
  );
};

export default SkipLinks;