import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { isAuthenticated, clearAuthData, storeAuthData } from '@/utils/auth';

interface AuthContextType {
  isLoggedIn: boolean;
  login: (token: string, expiresIn: number) => void;
  logout: () => void;
  user: UserProfile | null;
  isAuthenticated: boolean; // Added for FuturesContext
}

interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: string;
}

export const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  login: () => {},
  logout: () => {},
  user: null,
  isAuthenticated: false // Added for FuturesContext
});

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [user, setUser] = useState<UserProfile | null>(null);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      const authenticated = isAuthenticated();
      setIsLoggedIn(authenticated);
      
      if (authenticated) {
        try {
          // In a real app, you would fetch the user profile here
          // For now, we'll use mock data
          setUser({
            id: '1',
            username: 'trader',
            email: 'trader@example.com',
            role: 'user'
          });
        } catch (error) {
          console.error('Failed to fetch user profile:', error);
          logout();
        }
      }
    };
    
    checkAuth();
  }, []);

  const login = (token: string, expiresIn: number) => {
    storeAuthData(token, expiresIn);
    setIsLoggedIn(true);
    
    // Set mock user data
    setUser({
      id: '1',
      username: 'trader',
      email: 'trader@example.com',
      role: 'user'
    });
  };

  const logout = () => {
    clearAuthData();
    setIsLoggedIn(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      isLoggedIn, 
      login, 
      logout, 
      user,
      isAuthenticated: isLoggedIn // Added for FuturesContext
    }}>
      {children}
    </AuthContext.Provider>
  );
};
