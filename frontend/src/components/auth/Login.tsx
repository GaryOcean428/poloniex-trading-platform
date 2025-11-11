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
      setError('Please enter both email/username and password');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Use new JWT login method
      const success = await login(username, password);
      
      if (success) {
        // console.log('Login successful');
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setError('Invalid email/username or password. Try demo/password');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(errorMessage);
      // console.error('Login error:', err);
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
            <label htmlFor="username" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-100">
              Email or Username
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your email or username"
              disabled={isLoading}
              autoComplete="username"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-100">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={isLoading}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }}
            />
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            <p>Demo credentials: username: <strong>demo</strong>, password: <strong>password</strong></p>
            <p>Or try: username: <strong>trader</strong>, password: <strong>password</strong></p>
          </div>

          {/* Hidden submit button for Enter key accessibility */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1}>Submit</button>
        </form>
      </CardBody>
      <CardFooter className="flex justify-between">
        <Button variant="outline" disabled={isLoading}>
          Register
        </Button>
        <Button
          type="button"
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
