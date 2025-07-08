import React from 'react';
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

  const handleLogout = () => {
    logout();
    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <Button 
      variant={variant} 
      onClick={handleLogout}
      className={className}
    >
      Logout
    </Button>
  );
};

export default LogoutButton;
