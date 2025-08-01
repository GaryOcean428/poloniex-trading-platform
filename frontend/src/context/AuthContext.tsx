import { authService } from '@/services/authService';
import { getUserData, isAuthenticated, storeAuthDataLegacy } from '@/utils/auth';
import React, { ReactNode, createContext, useEffect, useState } from 'react';

/* eslint-disable no-console */

interface AuthContextType {
  isLoggedIn: boolean;
  login: (usernameOrToken: string, passwordOrExpiresIn?: string | number) => Promise<boolean>;
  logout: () => Promise<void>;
  user: UserProfile | null;
  isAuthenticated: boolean; // Added for FuturesContext
  loading: boolean;
  refreshToken: () => Promise<boolean>;
}

interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: string;
}

export const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  login: async () => false,
  logout: async () => { },
  user: null,
  isAuthenticated: false, // Added for FuturesContext
  loading: false,
  refreshToken: async () => false
});

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);

      try
      {
        const authenticated = isAuthenticated();
        setIsLoggedIn(authenticated);

        if (authenticated)
        {
          // Get user data from localStorage first
          const userData = getUserData();
          if (userData)
          {
            setUser(userData as UserProfile);
          }

          // Verify token with server
          const isValid = await authService.verifyToken();
          if (!isValid)
          {
            // console.warn('Token verification failed, logging out');
            await logout();
          }
        }
      } catch (error)
      {
        // console.error('Auth check error:', error);
        await logout();
      } finally
      {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (usernameOrToken: string, passwordOrExpiresIn?: string | number): Promise<boolean> => {
    try
    {
      // Check if this is JWT login (new method) or legacy login
      if (typeof passwordOrExpiresIn === 'string')
      {
        // New JWT login method
        const response = await authService.login({
          username: usernameOrToken,
          password: passwordOrExpiresIn
        });

        if (response.success && response.data)
        {
          setIsLoggedIn(true);
          setUser(response.data.user);
          return true;
        } else
        {
          // console.error('Login failed:', response.error);
          return false;
        }
      } else
      {
        // Legacy login method for backward compatibility
        const token = usernameOrToken;
        const expiresIn = passwordOrExpiresIn as number || 3600;

        storeAuthDataLegacy(token, expiresIn);
        setIsLoggedIn(true);

        // Set mock user data for legacy login
        setUser({
          id: '1',
          username: 'trader',
          email: 'trader@example.com',
          role: 'user'
        });

        return true;
      }
    } catch (error)
    {
      // console.error('Login error:', error);
      return false;
    }
  };

  const logout = async (): Promise<void> => {
    try
    {
      await authService.logout();
    } catch (error)
    {
      // console.error('Logout error:', error);
    } finally
    {
      setIsLoggedIn(false);
      setUser(null);
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    try
    {
      const newToken = await authService.refreshToken();
      if (newToken)
      {
        // Token refreshed successfully
        return true;
      } else
      {
        // Refresh failed, log out
        await logout();
        return false;
      }
    } catch (error)
    {
      // console.error('Token refresh error:', error);
      await logout();
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{
      isLoggedIn,
      login,
      logout,
      user,
      isAuthenticated: isLoggedIn, // Added for FuturesContext
      loading,
      refreshToken
    }}>
      {children}
    </AuthContext.Provider>
  );
};
