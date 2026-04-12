/**
 * API Client Service
 * Centralized HTTP client for making API requests to backend
 */

import { getBackendUrl } from '@/utils/environment';
import { getAccessToken } from '@/utils/auth';
import { deduplicatedFetch } from '@/utils/requestDeduplicator';

const BASE_URL = getBackendUrl();

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
}

class APIClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<{ data: T }> {
    const url = `${this.baseURL}/api${endpoint}`;
    const method = options.method || 'GET';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add auth token if available
    const token = getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (options.body && method !== 'GET') {
      config.body = JSON.stringify(options.body);
    }

    const doFetch = async (): Promise<{ data: T }> => {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          response: {
            status: response.status,
            data: errorData,
          },
        };
      }

      const data = await response.json();
      return { data };
    };

    // Deduplicate concurrent identical GET requests
    if (method === 'GET') {
      return deduplicatedFetch<{ data: T }>(url, doFetch);
    }

    return doFetch();
  }

  async get<T>(endpoint: string, headers?: Record<string, string>): Promise<{ data: T }> {
    return this.request<T>(endpoint, { method: 'GET', headers });
  }

  async post<T>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<{ data: T }> {
    return this.request<T>(endpoint, { method: 'POST', body, headers });
  }

  async put<T>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<{ data: T }> {
    return this.request<T>(endpoint, { method: 'PUT', body, headers });
  }

  async delete<T>(endpoint: string, headers?: Record<string, string>): Promise<{ data: T }> {
    return this.request<T>(endpoint, { method: 'DELETE', headers });
  }

  async patch<T>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<{ data: T }> {
    return this.request<T>(endpoint, { method: 'PATCH', body, headers });
  }
}

export const apiClient = new APIClient(BASE_URL);
