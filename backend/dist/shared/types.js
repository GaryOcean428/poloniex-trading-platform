// Single entry point for shared types so that consumers can import '@shared/types'
// and receive the full consolidated type surface from 'shared/types/index.ts'.
// This avoids ambiguous imports between 'shared/types.ts' and 'shared/types/index.ts'.
export * from './types/index.js';
