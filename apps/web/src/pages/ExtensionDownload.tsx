import React, { useState } from 'react';
import { 
  Download, 
  Chrome, 
  MessageSquare, 
  Check, 
  AlertTriangle, 
  ArrowRight, 
  Info,
  Loader,
  Settings,
  ChevronDown,
  ChevronUp,
  Lock
} from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { createExtensionZip } from '../utils/extensionHelper';
import ExtensionControls from '../components/Extension/ExtensionControls';

const ExtensionDownload: React.FC = () => {
  const { apiKey, apiSecret } = useSettings();
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false);

  // Function to trigger the extension download
  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      setDownloadComplete(false);
      
      // Create and download the extension zip
      await createExtensionZip();
      
      setDownloadComplete(true);
    } catch (_error) {
      // console.error('Error downloading extension:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  // Function to copy the extension ID to clipboard
  const copyExtensionId = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToClipboard(true);
    setTimeout(() => setCopiedToClipboard(false), 3000);
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-lg shadow-lg p-6 text-white">
        <div className="flex items-center">
          <Chrome className="h-12 w-12 mr-4" />
          <div>
            <h1 className="text-2xl font-bold">Trading Extension for Chrome</h1>
            <p className="opacity-90">Integrate TradingView charts with Poloniex trading in one powerful tool</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="trading-card">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <Download className="h-5 w-5 mr-2 text-blue-500" />
              Download and Install
            </h2>
            
            <div className="space-y-6">
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 text-blue-700">
                <div className="flex">
                  <Info className="h-6 w-6 mr-2 flex-shrink-0" />
                  <p>
                    This Chrome extension integrates TradingView and Poloniex, allowing you to extract chart data, 
                    execute trades directly from charts, and manage your positions seamlessly.
                  </p>
                </div>
              </div>
              
              <div>
                <button 
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-md shadow-md flex items-center justify-center w-full md:w-auto disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isDownloading ? (
                    <>
                      <Loader className="h-5 w-5 mr-2 animate-spin" />
                      Creating Extension...
                    </>
                  ) : downloadComplete ? (
                    <>
                      <Check className="h-5 w-5 mr-2" />
                      Download Again
                    </>
                  ) : (
                    <>
                      <Download className="h-5 w-5 mr-2" />
                      Download Extension Package
                    </>
                  )}
                </button>
                <p className="text-sm text-neutral-500 mt-2">
                  {downloadComplete 
                    ? "Extension package downloaded successfully! Extract the ZIP file to continue."
                    : "Downloads a ZIP file containing the extension files"}
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-1 mr-3">1</div>
                  <div>
                    <h3 className="font-semibold">Extract the ZIP file</h3>
                    <p className="text-neutral-600">Unzip the downloaded file to a location you'll remember, like your Desktop or Documents folder.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-1 mr-3">2</div>
                  <div>
                    <h3 className="font-semibold">Open Chrome Extensions Page</h3>
                    <p className="text-neutral-600">In Chrome, go to <code className="bg-neutral-100 px-1.5 py-0.5 rounded">chrome://extensions</code> or select <strong>Menu</strong> <ArrowRight className="inline h-3 w-3" /> <strong>Settings</strong> <ArrowRight className="inline h-3 w-3" /> <strong>Extensions</strong></p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-1 mr-3">3</div>
                  <div>
                    <h3 className="font-semibold">Enable Developer Mode</h3>
                    <p className="text-neutral-600">Toggle the "Developer mode" switch in the top-right corner of the extensions page.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-1 mr-3">4</div>
                  <div>
                    <h3 className="font-semibold">Load the Extension</h3>
                    <p className="text-neutral-600">Click the "Load unpacked" button and select the folder where you extracted the ZIP file.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-1 mr-3">5</div>
                  <div>
                    <h3 className="font-semibold">Pin the Extension</h3>
                    <p className="text-neutral-600">Click the puzzle piece icon in Chrome's toolbar, find the Poloniex Trading Extension, and click the pin icon.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="trading-card">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <MessageSquare className="h-5 w-5 mr-2 text-blue-500" />
              Extension Features
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2 text-blue-800">TradingView Integration</h3>
                <ul className="space-y-2">
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-blue-500 mr-2 mt-1" />
                    <span className="text-sm">Extract real-time chart data and indicators</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-blue-500 mr-2 mt-1" />
                    <span className="text-sm">Add overlay buttons for quick trading</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-blue-500 mr-2 mt-1" />
                    <span className="text-sm">Cache chart layouts and preferences</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-blue-500 mr-2 mt-1" />
                    <span className="text-sm">Real-time data streaming via WebSocket</span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-indigo-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2 text-indigo-800">Poloniex Trading Features</h3>
                <ul className="space-y-2">
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-indigo-500 mr-2 mt-1" />
                    <span className="text-sm">Display real-time account balances and positions</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-indigo-500 mr-2 mt-1" />
                    <span className="text-sm">One-click trading from TradingView charts</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-indigo-500 mr-2 mt-1" />
                    <span className="text-sm">Automated trading based on indicators</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-indigo-500 mr-2 mt-1" />
                    <span className="text-sm">Risk management controls and trading limits</span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2 text-green-800">Data Management</h3>
                <ul className="space-y-2">
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-green-500 mr-2 mt-1" />
                    <span className="text-sm">Store historical price data locally</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-green-500 mr-2 mt-1" />
                    <span className="text-sm">Sync data between platforms in real-time</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-green-500 mr-2 mt-1" />
                    <span className="text-sm">Export trading data and performance metrics</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-green-500 mr-2 mt-1" />
                    <span className="text-sm">Monitor connection status with both platforms</span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2 text-purple-800">User Interface</h3>
                <ul className="space-y-2">
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-purple-500 mr-2 mt-1" />
                    <span className="text-sm">Clean, intuitive popup interface</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-purple-500 mr-2 mt-1" />
                    <span className="text-sm">Quick access to charts and order entry</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-purple-500 mr-2 mt-1" />
                    <span className="text-sm">Customizable alerts and notifications</span>
                  </li>
                  <li className="flex items-start">
                    <Check className="h-4 w-4 text-purple-500 mr-2 mt-1" />
                    <span className="text-sm">Keyboard shortcuts for common actions</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="trading-card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center">
                <Settings className="h-5 w-5 mr-2 text-blue-500" />
                Configure and Use
              </h2>
              <button 
                onClick={() => setShowAdvancedInfo(!showAdvancedInfo)}
                className="flex items-center text-sm text-brand-cyan"
              >
                {showAdvancedInfo ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Hide Advanced Info
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Show Advanced Info
                  </>
                )}
              </button>
            </div>
            
            <div className="space-y-4">
              {(!apiKey || !apiSecret) ? (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                  <div className="flex">
                    <AlertTriangle className="h-6 w-6 mr-2 text-yellow-400 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-yellow-700">API Credentials Not Set</p>
                      <p className="text-yellow-600">
                        Please set your Poloniex API credentials in the Settings page to enable full functionality in the extension.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border-l-4 border-green-400 p-4">
                  <div className="flex">
                    <Check className="h-6 w-6 mr-2 text-green-500 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-green-700">API Credentials Found</p>
                      <p className="text-green-600">
                        Your API credentials are set up and will be used by the extension.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">Getting Started</h3>
                <ol className="space-y-2 list-decimal pl-5">
                  <li className="text-blue-700">Install the extension following the steps above</li>
                  <li className="text-blue-700">Set your API credentials in the Settings page</li>
                  <li className="text-blue-700">Click the extension icon in Chrome to access the trading popup</li>
                  <li className="text-blue-700">Visit TradingView and the extension will automatically recognize chart data</li>
                  <li className="text-blue-700">Use the "Quick Trade" buttons that appear on the TradingView chart</li>
                </ol>
              </div>
              
              {showAdvancedInfo && (
                <>
                  <div className="mt-4">
                    <h3 className="font-semibold mb-2">Extension Integration</h3>
                    <p className="text-neutral-600 mb-3">
                      To connect the extension with your personal trading platform, you'll need to note the extension ID after installation.
                    </p>
                    
                    <div className="bg-neutral-100 p-3 rounded-md mb-2">
                      <div className="font-mono text-sm flex items-center">
                        <Lock className="h-4 w-4 mr-2 text-neutral-500" />
                        jcdmopolmojdhpclfbemdpcdneobmnje
                      </div>
                    </div>
                    
                    <p className="text-sm text-neutral-500 mb-4">
                      After installation, you can find this ID on the extensions page by clicking "Details" on the Poloniex Trading Extension.
                    </p>
                    
                    <button
                      onClick={() => copyExtensionId('jcdmopolmojdhpclfbemdpcdneobmnje')}
                      className="bg-neutral-200 hover:bg-neutral-300 text-neutral-800 py-2 px-4 rounded-md text-sm flex items-center"
                    >
                      {copiedToClipboard ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <span className="mr-1">Copy Extension ID</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  <div className="mt-4">
                    <h3 className="font-semibold mb-2">Technical Details</h3>
                    <ul className="space-y-2 text-sm text-neutral-600">
                      <li className="flex items-start">
                        <Check className="h-4 w-4 text-neutral-500 mr-2 mt-0.5" />
                        <span>Uses Manifest v3 for Chrome Extensions</span>
                      </li>
                      <li className="flex items-start">
                        <Check className="h-4 w-4 text-neutral-500 mr-2 mt-0.5" />
                        <span>API keys are stored securely in extension storage</span>
                      </li>
                      <li className="flex items-start">
                        <Check className="h-4 w-4 text-neutral-500 mr-2 mt-0.5" />
                        <span>Content scripts inject into TradingView and Poloniex</span>
                      </li>
                      <li className="flex items-start">
                        <Check className="h-4 w-4 text-neutral-500 mr-2 mt-0.5" />
                        <span>Background service worker handles API connections</span>
                      </li>
                      <li className="flex items-start">
                        <Check className="h-4 w-4 text-neutral-500 mr-2 mt-0.5" />
                        <span>WebSocket connection for real-time data streaming</span>
                      </li>
                    </ul>
                  </div>
                  
                  <div className="mt-4">
                    <h3 className="font-semibold mb-2">Extension Controls Preview</h3>
                    <ExtensionControls />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="col-span-1">
          <div className="trading-card mb-6">
            <h2 className="text-xl font-bold mb-4">Key Benefits</h2>
            <ul className="space-y-3">
              <li className="flex items-start">
                <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">1</div>
                <div>
                  <h3 className="font-semibold">TradingView + Poloniex Integration</h3>
                  <p className="text-sm text-neutral-600">Use TradingView's powerful charts with Poloniex's trading capabilities.</p>
                </div>
              </li>
              <li className="flex items-start">
                <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">2</div>
                <div>
                  <h3 className="font-semibold">One-Click Trading</h3>
                  <p className="text-sm text-neutral-600">Execute trades directly from TradingView charts without switching tabs.</p>
                </div>
              </li>
              <li className="flex items-start">
                <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">3</div>
                <div>
                  <h3 className="font-semibold">Automated Strategies</h3>
                  <p className="text-sm text-neutral-600">Create indicator-based strategies that can execute trades automatically.</p>
                </div>
              </li>
              <li className="flex items-start">
                <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">4</div>
                <div>
                  <h3 className="font-semibold">Risk Management</h3>
                  <p className="text-sm text-neutral-600">Set position size limits and customize risk parameters for safer trading.</p>
                </div>
              </li>
              <li className="flex items-start">
                <div className="bg-blue-100 text-blue-700 rounded-full h-6 w-6 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">5</div>
                <div>
                  <h3 className="font-semibold">Data Synchronization</h3>
                  <p className="text-sm text-neutral-600">Keep your trading platform and charts in sync for better decision making.</p>
                </div>
              </li>
            </ul>
          </div>
          
          <div className="trading-card">
            <h2 className="text-xl font-bold mb-4">Screenshots</h2>
            <div className="space-y-3">
              <div className="border rounded-md overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" 
                  alt="TradingView chart with extension buttons" 
                  className="w-full"
                />
                <div className="p-2 text-xs text-neutral-500">TradingView Integration</div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1642790551116-18ced420e119?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" 
                  alt="Extension popup interface" 
                  className="w-full"
                />
                <div className="p-2 text-xs text-neutral-500">Trading Dashboard</div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1642790095453-7942ef0a0fdd?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" 
                  alt="Strategy builder interface" 
                  className="w-full"
                />
                <div className="p-2 text-xs text-neutral-500">Strategy Builder</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExtensionDownload;
