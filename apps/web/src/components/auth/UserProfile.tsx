import React from 'react';
import { useAuth } from '../../hooks/useAuth';

interface UserProfileProps {
  className?: string;
}

const UserProfile: React.FC<UserProfileProps> = ({ className = '' }) => {
  const { user, isLoggedIn } = useAuth();

  if (!isLoggedIn || !user) {
    return null;
  }

  return (
    <div className={`flex items-center ${className}`}>
      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold mr-2">
        {user.username.charAt(0).toUpperCase()}
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{user.username}</span>
        <span className="text-xs text-neutral-500">{user.email}</span>
      </div>
    </div>
  );
};

export default UserProfile;
