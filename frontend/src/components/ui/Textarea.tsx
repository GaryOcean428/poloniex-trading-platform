import React from 'react';

export interface TextareaProps {
  id?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  className?: string;
  rows?: number;
  disabled?: boolean;
  required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
}

export const Textarea: React.FC<TextareaProps> = ({
  id,
  name,
  value,
  placeholder,
  className = '',
  rows = 4,
  disabled = false,
  required = false,
  onChange,
  onBlur
}) => {
  return (
    <textarea
      id={id}
      name={name}
      value={value}
      placeholder={placeholder}
      className={`w-full px-3 py-2 text-neutral-700 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        disabled ? 'bg-neutral-100 cursor-not-allowed' : 'bg-white'
      } ${className}`}
      rows={rows}
      disabled={disabled}
      required={required}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
};

export default Textarea;
