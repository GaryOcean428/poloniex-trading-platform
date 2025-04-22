import { useState } from 'react';
import { useSettings } from '@/context/SettingsContext';
import { Card, CardHeader, CardBody, Button, Textarea, Alert } from '@/components/ui';

const SettingsExportImport: React.FC = () => {
  const { exportSettings, importSettings } = useSettings();
  const [importData, setImportData] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExport = () => {
    const settingsJson = exportSettings();
    
    // Create a download link
    const blob = new Blob([settingsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poloniex-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
    
    setMessage({ type: 'success', text: 'Settings exported successfully' });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleImport = () => {
    if (!importData.trim()) {
      setMessage({ type: 'error', text: 'Please paste settings JSON data' });
      return;
    }
    
    const success = importSettings(importData);
    
    if (success) {
      setMessage({ type: 'success', text: 'Settings imported successfully' });
      setImportData('');
    } else {
      setMessage({ type: 'error', text: 'Failed to import settings. Invalid format.' });
    }
    
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <h3 className="text-lg font-medium">Export/Import Settings</h3>
      </CardHeader>
      <CardBody>
        {message && (
          <Alert 
            variant={message.type} 
            className="mb-4"
          >
            {message.text}
          </Alert>
        )}
        
        <div className="mb-6">
          <h4 className="text-md font-medium mb-2">Export Settings</h4>
          <p className="text-sm text-gray-500 mb-2">
            Export your settings to a JSON file that you can save and import later.
            API keys and secrets are not included in the export for security reasons.
          </p>
          <Button onClick={handleExport}>
            Export Settings
          </Button>
        </div>
        
        <div>
          <h4 className="text-md font-medium mb-2">Import Settings</h4>
          <p className="text-sm text-gray-500 mb-2">
            Paste previously exported settings JSON below to restore your configuration.
          </p>
          <Textarea
            value={importData}
            onChange={(e) => setImportData(e.target.value)}
            placeholder="Paste settings JSON here..."
            rows={6}
            className="mb-2"
          />
          <Button onClick={handleImport}>
            Import Settings
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

export default SettingsExportImport;
