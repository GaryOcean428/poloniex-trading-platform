import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Card, CardHeader, CardBody, CardFooter, Alert } from '@/components/ui';

interface LoginProps {
  onSuccess?: () => void;
}

const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      setError('Please enter both username and password');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // In a real app, this would be an API call
      // For now, we'll simulate a successful login with mock data
      if (username === 'demo' && password === 'password') {
        // Simulate API response delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Mock token and expiry
        const token = 'mock-jwt-token-' + Math.random().toString(36).substring(2);
        const expiresIn = 3600; // 1 hour
        
        login(token, expiresIn);
        
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setError('Invalid username or password. Try demo/password');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
      console.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <h2 className="text-xl font-bold">Login to Your Account</h2>
      </CardHeader>
      <CardBody>
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="username" className="block text-sm font-medium mb-1">
              Username
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              disabled={isLoading}
            />
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={isLoading}
            />
          </div>
          <div className="mt-2 text-sm text-neutral-500">
            <p>Demo credentials: username: demo, password: password</p>
          </div>
        </form>
      </CardBody>
      <CardFooter className="flex justify-between">
        <Button variant="outline" disabled={isLoading}>
          Register
        </Button>
        <Button 
          type="submit" 
          onClick={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? 'Logging in...' : 'Login'}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default Login;
