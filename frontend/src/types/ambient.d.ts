// Minimal ambient declarations for production builds without dev type packages

// Provide a permissive chrome namespace so TS recognizes references
// Do NOT add runtime behavior; this is types only.
declare global {
  interface Window {
    chrome?: any;
  }
}

declare namespace chrome {
  const runtime: any;
  const tabs: any;
  const windows: any;
}

// React 18+ client shim to avoid missing type during CI in some environments
declare module 'react-dom/client' {
  export * from 'react-dom';
}

// Optional: declare OpenAI module to avoid TS resolution errors if needed
// declare module 'openai';

export {};
