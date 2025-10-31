import React from 'react';

export interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ className = '', children }) => {
  return (
    <div className={`bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 rounded-lg shadow-md p-4 ${className}`}>
      {children}
    </div>
  );
};

export interface CardHeaderProps {
  className?: string;
  children: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ className = '', children }) => {
  return (
    <div className={`border-b border-neutral-200 dark:border-neutral-700 pb-3 mb-4 font-semibold text-lg text-gray-900 dark:text-gray-100 ${className}`}>
      {children}
    </div>
  );
};

export interface CardTitleProps {
  className?: string;
  children: React.ReactNode;
}

export const CardTitle: React.FC<CardTitleProps> = ({ className = '', children }) => {
  return (
    <h3 className={`font-bold text-xl ${className}`}>
      {children}
    </h3>
  );
};

export interface CardBodyProps {
  className?: string;
  children: React.ReactNode;
}

export const CardBody: React.FC<CardBodyProps> = ({ className = '', children }) => {
  return (
    <div className={`${className}`}>
      {children}
    </div>
  );
};

// Alias for CardBody to support both naming conventions
export const CardContent: React.FC<CardBodyProps> = CardBody;

export interface CardFooterProps {
  className?: string;
  children: React.ReactNode;
}

export const CardFooter: React.FC<CardFooterProps> = ({ className = '', children }) => {
  return (
    <div className={`border-t border-neutral-200 dark:border-neutral-700 pt-3 mt-4 ${className}`}>
      {children}
    </div>
  );
};

export default Card;
