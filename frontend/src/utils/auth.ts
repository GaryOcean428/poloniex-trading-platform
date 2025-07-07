import CryptoJS from 'crypto-js';

interface SignatureParams {
  method: string;
  path: string;
  body?: any;
  queryString?: string;
  timestamp: number;
  secret: string;
}

/**
 * Generate HMAC-SHA256 signature for API authentication
 */
export function generateSignature({
  method,
  path,
  body,
  queryString,
  timestamp,
  secret
}: SignatureParams): string {
  // Create the string to sign
  let signString = `${method}\n${path}`;
  
  if (queryString) {
    signString += `?${queryString}`;
  }
  
  signString += `\nsignTimestamp=${timestamp}`;
  
  if (body) {
    signString += `\n${JSON.stringify(body)}`;
  }
  
  // Create HMAC SHA256 signature
  const signature = CryptoJS.HmacSHA256(signString, secret).toString(CryptoJS.enc.Hex);
  
  return signature;
}

/**
 * Generate authentication headers for API requests
 */
export function generateAuthHeaders(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  body?: any,
  queryString?: string
): Record<string, string> {
  const timestamp = Date.now();
  
  const signature = generateSignature({
    method,
    path,
    body,
    queryString,
    timestamp,
    secret: apiSecret
  });
  
  return {
    'API-Key': apiKey,
    'API-Sign': signature,
    'API-Timestamp': timestamp.toString(),
    'Content-Type': 'application/json'
  };
}

/**
 * Verify if a user is authenticated
 */
export function isAuthenticated(): boolean {
  // Check for authentication token in localStorage
  const token = localStorage.getItem('auth_token');
  const expiry = localStorage.getItem('auth_expiry');
  
  if (!token || !expiry) {
    return false;
  }
  
  // Check if token is expired
  const expiryTime = parseInt(expiry, 10);
  if (Date.now() > expiryTime) {
    // Clear expired token
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_expiry');
    return false;
  }
  
  return true;
}

/**
 * Store authentication data
 */
export function storeAuthData(token: string, expiresIn: number): void {
  const expiryTime = Date.now() + expiresIn * 1000;
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_expiry', expiryTime.toString());
}

/**
 * Clear authentication data
 */
export function clearAuthData(): void {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_expiry');
}

/**
 * Get authentication token
 */
export function getAuthToken(): string | null {
  if (!isAuthenticated()) {
    return null;
  }
  
  return localStorage.getItem('auth_token');
}
