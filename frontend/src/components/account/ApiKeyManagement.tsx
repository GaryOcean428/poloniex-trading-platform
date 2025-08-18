import { AlertTriangle, CheckCircle, Plus, RefreshCw, Shield, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAccessToken } from '@/utils/auth';

interface ApiCredential {
  id: string;
  exchange: string;
  credentialName: string;
  permissions: {
    read: boolean;
    trade: boolean;
    withdraw: boolean;
  };
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface NewCredentialForm {
  credentialName: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  permissions: {
    read: boolean;
    trade: boolean;
    withdraw: boolean;
  };
}

const ApiKeyManagement: React.FC = () => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [apiCredentials, setApiCredentials] = useState<ApiCredential[]>([]);

  const [newCredentialForm, setNewCredentialForm] = useState<NewCredentialForm>({
    credentialName: '',
    apiKey: '',
    apiSecret: '',
    passphrase: '',
    permissions: {
      read: true,
      trade: false,
      withdraw: false
    }
  });

  // API base URL
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // Clear messages after 5 seconds
  useEffect(() => {
    if (successMessage || error) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, error]);

  const loadApiCredentials = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = getAccessToken();
      if (!token) {
        setError('You must be logged in to view API credentials');
        return;
      }

      const response = await fetch(`${API_BASE}/api/keys`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load API credentials');
      }

      const data = await response.json();
      if (data.success) {
        setApiCredentials(data.credentials);
      } else {
        throw new Error(data.error || 'Failed to load API credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API credentials');
    } finally {
      setLoading(false);
    }
  };

  // Load API credentials on component mount
  useEffect(() => {
    loadApiCredentials();
  }, [loadApiCredentials]);

  const handleFormChange = (field: keyof NewCredentialForm, value: string) => {
    setNewCredentialForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handlePermissionChange = (permission: 'read' | 'trade' | 'withdraw') => {
    setNewCredentialForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permission]: !prev.permissions[permission]
      }
    }));
  };

  const handleCreateCredentials = async () => {
    if (!newCredentialForm.credentialName.trim() || !newCredentialForm.apiKey.trim() || !newCredentialForm.apiSecret.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const token = getAccessToken();
      if (!token) {
        setError('You must be logged in to create API credentials');
        return;
      }

      const response = await fetch(`${API_BASE}/api/keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credentialName: newCredentialForm.credentialName,
          apiKey: newCredentialForm.apiKey,
          apiSecret: newCredentialForm.apiSecret,
          passphrase: newCredentialForm.passphrase || undefined,
          permissions: newCredentialForm.permissions
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create API credentials');
      }

      const data = await response.json();
      if (data.success) {
        setSuccessMessage('API credentials created successfully');
        setShowCreateForm(false);
        setNewCredentialForm({
          credentialName: '',
          apiKey: '',
          apiSecret: '',
          passphrase: '',
          permissions: {
            read: true,
            trade: false,
            withdraw: false
          }
        });
        // Reload credentials
        await loadApiCredentials();
      } else {
        throw new Error(data.error || 'Failed to create API credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API credentials');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCredentials = async (id: string) => {
    if (!confirm('Are you sure you want to delete these API credentials? This action cannot be undone.')) {
      return;
    }

    try {
      const token = getAccessToken();
      if (!token) {
        setError('You must be logged in to delete API credentials');
        return;
      }

      const response = await fetch(`${API_BASE}/api/keys/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete API credentials');
      }

      const data = await response.json();
      if (data.success) {
        setSuccessMessage('API credentials deleted successfully');
        // Reload credentials
        await loadApiCredentials();
      } else {
        throw new Error(data.error || 'Failed to delete API credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete API credentials');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Success Message */}
      {successMessage && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 text-green-700">
          <div className="flex">
            <CheckCircle className="h-5 w-5 mr-3 flex-shrink-0" />
            <p>{successMessage}</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 text-red-700">
          <div className="flex">
            <XCircle className="h-5 w-5 mr-3 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Security Warning */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4 text-blue-700">
        <div className="flex">
          <Shield className="h-6 w-6 mr-3 flex-shrink-0" />
          <div>
            <h3 className="font-medium">API Key Security</h3>
            <p className="mt-1 text-sm">
              Keep your API keys secure. Never share them with others or expose them in client-side code.
              Keys with trade and withdraw permissions should be used with extreme caution.
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Your API Keys</h2>
        <div className="flex space-x-2">
          <button
            onClick={loadApiCredentials}
            disabled={loading}
            className="flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
            title="Refresh API credentials list"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add API Keys
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
            <h3 className="font-medium">Add Poloniex API Keys</h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="credential-name" className="block text-sm font-medium text-neutral-700">
                Credential Name *
              </label>
              <input
                type="text"
                id="credential-name"
                value={newCredentialForm.credentialName}
                onChange={(e) => handleFormChange('credentialName', e.target.value)}
                className="mt-1 block w-full border border-neutral-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Main Trading Account"
                required
              />
            </div>

            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-neutral-700">
                API Key *
              </label>
              <input
                type="text"
                id="api-key"
                value={newCredentialForm.apiKey}
                onChange={(e) => handleFormChange('apiKey', e.target.value)}
                className="mt-1 block w-full border border-neutral-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono"
                placeholder="Enter your Poloniex API Key"
                required
              />
            </div>

            <div>
              <label htmlFor="api-secret" className="block text-sm font-medium text-neutral-700">
                API Secret *
              </label>
              <input
                type="password"
                id="api-secret"
                value={newCredentialForm.apiSecret}
                onChange={(e) => handleFormChange('apiSecret', e.target.value)}
                className="mt-1 block w-full border border-neutral-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono"
                placeholder="Enter your Poloniex API Secret"
                required
              />
            </div>

            <div>
              <label htmlFor="passphrase" className="block text-sm font-medium text-neutral-700">
                Passphrase (Optional)
              </label>
              <input
                type="password"
                id="passphrase"
                value={newCredentialForm.passphrase}
                onChange={(e) => handleFormChange('passphrase', e.target.value)}
                className="mt-1 block w-full border border-neutral-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono"
                placeholder="Enter passphrase if required"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-neutral-700 mb-2">
                Permissions
              </span>
              <div className="space-y-2">
                <div className="flex items-center">
                  <input
                    id="permission-read"
                    type="checkbox"
                    checked={newCredentialForm.permissions.read}
                    onChange={() => handlePermissionChange('read')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
                  />
                  <label htmlFor="permission-read" className="ml-2 block text-sm text-neutral-700">
                    Read (View account balances and trades)
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    id="permission-trade"
                    type="checkbox"
                    checked={newCredentialForm.permissions.trade}
                    onChange={() => handlePermissionChange('trade')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
                  />
                  <label htmlFor="permission-trade" className="ml-2 block text-sm text-neutral-700">
                    Trade (Place and cancel orders)
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    id="permission-withdraw"
                    type="checkbox"
                    checked={newCredentialForm.permissions.withdraw}
                    onChange={() => handlePermissionChange('withdraw')}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-neutral-300 rounded"
                  />
                  <label htmlFor="permission-withdraw" className="ml-2 flex items-center text-sm text-neutral-700">
                    Withdraw (Transfer funds out of your account)
                    <span className="ml-2 text-red-600 flex items-center text-xs">
                      <AlertTriangle className="h-3 w-3 mr-0.5" />
                      High Risk
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                disabled={submitting}
                className="px-4 py-2 border border-neutral-300 rounded-md shadow-sm text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCredentials}
                disabled={submitting || !newCredentialForm.credentialName.trim() || !newCredentialForm.apiKey.trim() || !newCredentialForm.apiSecret.trim()}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Credentials'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials List */}
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
          <h3 className="font-medium">Your API Credentials</h3>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto text-neutral-400 mb-2" />
              <p className="text-neutral-500">Loading API credentials...</p>
            </div>
          ) : apiCredentials.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-neutral-500">No API credentials found. Add your first set of credentials to get started.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Exchange
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Permissions
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Last Used
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="relative px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {apiCredentials.map((credential) => (
                  <tr key={credential.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-neutral-900">
                      {credential.credentialName}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                      <span className="capitalize">{credential.exchange}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                      <div className="space-x-2">
                        {credential.permissions.read && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            Read
                          </span>
                        )}
                        {credential.permissions.trade && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Trade
                          </span>
                        )}
                        {credential.permissions.withdraw && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            Withdraw
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                      {formatDate(credential.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                      {credential.lastUsedAt ? formatDate(credential.lastUsedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${credential.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                        }`}>
                        {credential.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleDeleteCredentials(credential.id)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete API credentials"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApiKeyManagement;
