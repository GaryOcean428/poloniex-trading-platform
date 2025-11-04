// Content script for Poloniex Trading Platform web app
console.log('Poloniex Trading Platform extension loaded');

// Inject extension marker for detection
(function injectExtensionMarker() {
  const marker = document.createElement('div');
  marker.setAttribute('data-poloniex-extension', 'true');
  marker.setAttribute('data-version', chrome.runtime.getManifest().version);
  marker.setAttribute('data-extension-id', chrome.runtime.id);
  marker.style.display = 'none';
  document.documentElement.appendChild(marker);
  console.log('Extension marker injected - version:', chrome.runtime.getManifest().version);
})();

// Listen for messages from the web app
window.addEventListener('message', (event) => {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) return;
  
  if (event.data.type === 'EXTENSION_STATUS_REQUEST') {
    // Respond with extension status
    window.postMessage({
      type: 'EXTENSION_STATUS_RESPONSE',
      status: 'active',
      connected: true,
      version: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id
    }, '*');
  }
});

// Notify the page that extension is ready
window.postMessage({
  type: 'EXTENSION_READY',
  version: chrome.runtime.getManifest().version
}, '*');
