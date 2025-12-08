import React, { forwardRef, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface AccessibleInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  hideLabel?: boolean;
}

interface AccessibleSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  hideLabel?: boolean;
  children: React.ReactNode;
}

interface AccessibleTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  hideLabel?: boolean;
}

// Generate unique IDs for form elements
const generateId = () => `form-${Math.random().toString(36).substr(2, 9)}`;

const AccessibleInput = forwardRef<HTMLInputElement, AccessibleInputProps>(
  (
    {
      label,
      error,
      helpText,
      required = false,
      hideLabel = false,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || generateId();
    const errorId = error ? `${inputId}-error` : undefined;
    const helpTextId = helpText ? `${inputId}-help` : undefined;

    const inputClasses = [
      'block w-full rounded-md border-neutral-300 shadow-sm',
      'focus:border-blue-500 focus:ring-blue-500',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : '',
      className
    ].filter(Boolean).join(' ');

    return (
      <div className="space-y-1">
        <label
          htmlFor={inputId}
          className={`block text-sm font-medium text-neutral-700 ${hideLabel ? 'sr-only' : ''}`}
        >
          {label}
          {required && <span className="text-red-500 ml-1" aria-label="required">*</span>}
        </label>
        
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={[errorId, helpTextId].filter(Boolean).join(' ') || undefined}
          {...props}
        />
        
        {helpText && (
          <p id={helpTextId} className="text-sm text-neutral-500">
            {helpText}
          </p>
        )}
        
        {error && (
          <p id={errorId} className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

const AccessibleSelect = forwardRef<HTMLSelectElement, AccessibleSelectProps>(
  (
    {
      label,
      error,
      helpText,
      required = false,
      hideLabel = false,
      className = '',
      id,
      children,
      ...props
    },
    ref
  ) => {
    const selectId = id || generateId();
    const errorId = error ? `${selectId}-error` : undefined;
    const helpTextId = helpText ? `${selectId}-help` : undefined;

    const selectClasses = [
      'block w-full rounded-md border-neutral-300 shadow-sm',
      'focus:border-blue-500 focus:ring-blue-500',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : '',
      className
    ].filter(Boolean).join(' ');

    return (
      <div className="space-y-1">
        <label
          htmlFor={selectId}
          className={`block text-sm font-medium text-neutral-700 ${hideLabel ? 'sr-only' : ''}`}
        >
          {label}
          {required && <span className="text-red-500 ml-1" aria-label="required">*</span>}
        </label>
        
        <select
          ref={ref}
          id={selectId}
          className={selectClasses}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={[errorId, helpTextId].filter(Boolean).join(' ') || undefined}
          {...props}
        >
          {children}
        </select>
        
        {helpText && (
          <p id={helpTextId} className="text-sm text-neutral-500">
            {helpText}
          </p>
        )}
        
        {error && (
          <p id={errorId} className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

const AccessibleTextarea = forwardRef<HTMLTextAreaElement, AccessibleTextareaProps>(
  (
    {
      label,
      error,
      helpText,
      required = false,
      hideLabel = false,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const textareaId = id || generateId();
    const errorId = error ? `${textareaId}-error` : undefined;
    const helpTextId = helpText ? `${textareaId}-help` : undefined;

    const textareaClasses = [
      'block w-full rounded-md border-neutral-300 shadow-sm',
      'focus:border-blue-500 focus:ring-blue-500',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : '',
      className
    ].filter(Boolean).join(' ');

    return (
      <div className="space-y-1">
        <label
          htmlFor={textareaId}
          className={`block text-sm font-medium text-neutral-700 ${hideLabel ? 'sr-only' : ''}`}
        >
          {label}
          {required && <span className="text-red-500 ml-1" aria-label="required">*</span>}
        </label>
        
        <textarea
          ref={ref}
          id={textareaId}
          className={textareaClasses}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={[errorId, helpTextId].filter(Boolean).join(' ') || undefined}
          {...props}
        />
        
        {helpText && (
          <p id={helpTextId} className="text-sm text-neutral-500">
            {helpText}
          </p>
        )}
        
        {error && (
          <p id={errorId} className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

AccessibleInput.displayName = 'AccessibleInput';
AccessibleSelect.displayName = 'AccessibleSelect';
AccessibleTextarea.displayName = 'AccessibleTextarea';

export { AccessibleInput, AccessibleSelect, AccessibleTextarea };