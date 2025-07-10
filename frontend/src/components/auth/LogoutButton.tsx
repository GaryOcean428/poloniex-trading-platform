import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '@/components/ui';

interface LogoutButtonProps {
  onSuccess?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  className?: string;
}

const LogoutButton: React.FC<LogoutButtonProps> = ({ 
  onSuccess, 
  variant = 'outline',
  className = ''
}) => {
  const { logout } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    
    try {
      await logout();
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button 
      variant={variant} 
      onClick={handleLogout}
      disabled={isLoading}
      className={className}
    >
      {isLoading ? 'Logging out...' : 'Logout'}
    </Button>
  );
};

export default LogoutButton;
