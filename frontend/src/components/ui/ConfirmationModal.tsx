import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  requireTyping?: boolean;
  typingText?: string;
  danger?: boolean;
  children?: React.ReactNode;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  requireTyping = false,
  typingText = '',
  danger = false,
  children
}) => {
  const [typedText, setTypedText] = useState('');
  const [agreedToRisks, setAgreedToRisks] = useState(false);

  if (!isOpen) return null;

  const canConfirm = requireTyping 
    ? typedText === typingText && agreedToRisks
    : agreedToRisks;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm();
      setTypedText('');
      setAgreedToRisks(false);
    }
  };

  const handleClose = () => {
    setTypedText('');
    setAgreedToRisks(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={handleClose}
        />
        
        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6 z-10">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Icon */}
          <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${
            danger ? 'bg-red-100' : 'bg-yellow-100'
          } mb-4`}>
            <AlertTriangle className={`h-6 w-6 ${danger ? 'text-red-600' : 'text-yellow-600'}`} />
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
            {title}
          </h3>

          {/* Message */}
          <p className="text-sm text-gray-600 text-center mb-4">
            {message}
          </p>

          {/* Custom content */}
          {children && (
            <div className="mb-4">
              {children}
            </div>
          )}

          {/* Typing confirmation */}
          {requireTyping && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type <code className="bg-gray-100 px-2 py-1 rounded text-red-600 font-semibold">{typingText}</code> to confirm:
              </label>
              <input
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={typingText}
                autoFocus
              />
            </div>
          )}

          {/* Risk acknowledgment checkbox */}
          <div className="mb-6">
            <label className="flex items-start space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToRisks}
                onChange={(e) => setAgreedToRisks(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="text-sm text-gray-700">
                I understand the risks and consequences of this action
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex space-x-3">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
                danger
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              } ${
                !canConfirm ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
