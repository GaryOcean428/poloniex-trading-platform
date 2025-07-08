import { useState } from 'react';
import { Copy, Plus, Trash2, AlertTriangle, Shield, RefreshCw } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: {
    read: boolean;
    trade: boolean;
    withdraw: boolean;
  };
  createdAt: string;
  lastUsed: string;
  expiresAt: string | null;
}

const ApiKeyManagement: React.FC = () => {
  const { apiKey } = useSettings();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyForm, setNewKeyForm] = useState({
    name: '',
    permissions: {
      read: true,
      trade: false,
      withdraw: false
    },
    expiration: 'never'
  });
  
  // Mock API keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([
    {
      id: '1',
      name: 'Trading Bot',
      key: apiKey || 'ce8c5f37d8e94a11a3e9bf20e7e92f31',
      permissions: {
        read: true,
        trade: true,
        withdraw: false
      },
      createdAt: '2023-05-15T14:30:00Z',
      lastUsed: '2023-06-10T09:45:23Z',
      expiresAt: null
    }
  ]);
  
  // Handle form input changes
  const handlePermissionChange = (permission: 'read' | 'trade' | 'withdraw') => {
    setNewKeyForm({
      ...newKeyForm,
      permissions: {
        ...newKeyForm.permissions,
        [permission]: !newKeyForm.permissions[permission]
      }
    });
  };
  
  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Here you might want to show a toast notification
  };
  
  // Create a new API key
  const handleCreateKey = () => {
    // In a real app, you would call your API here
    const newKey: ApiKey = {
      id: Math.random().toString(36).substring(2, 11),
      name: newKeyForm.name,
      key: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
      permissions: newKeyForm.permissions,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      expiresAt: newKeyForm.expiration === 'never' ? null : new Date(Date.now() + parseInt(newKeyForm.expiration) * 24 * 60 * 60 * 1000).toISOString()
    };
    
    setApiKeys([...apiKeys, newKey]);
    setShowCreateForm(false);
    
    // Reset form
    setNewKeyForm({
      name: '',
      permissions: {
        read: true,
        trade: false,
        withdraw: false
      },
      expiration: 'never'
    });
  };
  
  // Delete API key
  const handleDeleteKey = (id: string) => {
    setApiKeys(apiKeys.filter(key => key.id !== id));
  };
  
  return (
    <div className="space-y-6">
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
      
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Your API Keys</h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-1" />
          Create New Key
        </button>
      </div>
      
      {showCreateForm && (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
            <h3 className="font-medium">Create New API Key</h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="key-name" className="block text-sm font-medium text-neutral-700">
                Key Name
              </label>
              <input
                type="text"
                id="key-name"
                value={newKeyForm.name}
                onChange={(e) => setNewKeyForm({...newKeyForm, name: e.target.value})}
                className="mt-1 block w-full border border-neutral-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Trading Bot"
                required
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
                    checked={newKeyForm.permissions.read}
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
                    checked={newKeyForm.permissions.trade}
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
                    checked={newKeyForm.permissions.withdraw}
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
            
            <div>
              <label htmlFor="key-expiration" className="block text-sm font-medium text-neutral-700">
                Expiration
              </label>
              <select
                id="key-expiration"
                value={newKeyForm.expiration}
                onChange={(e) => setNewKeyForm({...newKeyForm, expiration: e.target.value})}
                className="mt-1 block w-full border border-neutral-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="never">Never</option>
                <option value="30">30 Days</option>
                <option value="90">90 Days</option>
                <option value="180">180 Days</option>
                <option value="365">1 Year</option>
              </select>
            </div>
            
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 border border-neutral-300 rounded-md shadow-sm text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateKey}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Create Key
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200 flex justify-between items-center">
          <h3 className="font-medium">Current API Keys</h3>
          <button
            onClick={() => {}}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  API Key
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
                  Expires
                </th>
                <th scope="col" className="relative px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-neutral-200">
              {apiKeys.map((key) => (
                <tr key={key.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-neutral-900">
                    {key.name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    <div className="flex items-center space-x-2">
                      <code className="font-mono bg-neutral-100 px-2 py-1 rounded">
                        {key.key.slice(0, 8)}...{key.key.slice(-8)}
                      </code>
                      <button
                        onClick={() => copyToClipboard(key.key)}
                        className="text-neutral-400 hover:text-neutral-600"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    <div className="space-x-2">
                      {key.permissions.read && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Read
                        </span>
                      )}
                      {key.permissions.trade && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Trade
                        </span>
                      )}
                      {key.permissions.withdraw && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          Withdraw
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    {new Date(key.lastUsed).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500">
                    {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleDeleteKey(key.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyManagement;
