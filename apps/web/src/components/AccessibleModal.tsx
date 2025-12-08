import React, { useEffect, useRef, useCallback } from 'react';
import { useAccessibility } from '../hooks/useAccessibility';
import { X } from 'lucide-react';
import AccessibleButton from './AccessibleButton';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
}

const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdropClick = true,
  closeOnEscape = true
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { trapFocus, handleEscapeKey, setFocus } = useAccessibility();

  // Store the previously focused element
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
  }, [isOpen]);

  // Focus management
  useEffect(() => {
    if (isOpen && modalRef.current) {
      // Focus the modal container
      setFocus(modalRef.current);
      
      // Set up focus trap
      const cleanup = trapFocus(modalRef.current);
      
      return cleanup;
    }
  }, [isOpen, trapFocus, setFocus]);

  // Escape key handling
  useEffect(() => {
    if (isOpen && closeOnEscape) {
      const cleanup = handleEscapeKey(onClose);
      return cleanup;
    }
  }, [isOpen, closeOnEscape, handleEscapeKey, onClose]);

  // Restore focus when modal closes
  useEffect(() => {
    if (!isOpen && previousFocusRef.current) {
      setFocus(previousFocusRef.current);
    }
  }, [isOpen, setFocus]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnBackdropClick) {
      onClose();
    }
  }, [onClose, closeOnBackdropClick]);

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      
      {/* Modal container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={modalRef}
          className={`
            relative w-full ${sizeClasses[size]} bg-white rounded-lg shadow-xl
            transform transition-all
          `}
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-neutral-200">
            <h2 id="modal-title" className="text-lg font-semibold text-neutral-900">
              {title}
            </h2>
            <AccessibleButton
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close modal"
              className="text-neutral-400 hover:text-neutral-600"
            >
              <X size={20} />
            </AccessibleButton>
          </div>
          
          {/* Content */}
          <div className="p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccessibleModal;