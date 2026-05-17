// Vitest setup file for React Testing Library and jest-dom matchers
// Use Vitest-specific entry to ensure correct integration
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { TextEncoder, TextDecoder } from 'node:util';

// Globally mock heavy dependencies to keep test graph small and avoid OOMs
vi.mock('@tensorflow/tfjs', () => ({
  // minimal API surface if any code checks for presence
  tensor: () => ({}),
  loadLayersModel: vi.fn(async () => ({ predict: vi.fn(() => ({})) })),
  ready: vi.fn(async () => {}),
}));
vi.mock('@tensorflow/tfjs-node', () => ({}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), close: vi.fn() })),
  default: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), close: vi.fn() })),
}));

vi.mock('apexcharts', () => ({
  default: class ApexCharts { render() {}; updateOptions() {}; destroy() {}; },
}));
vi.mock('react-apexcharts', () => ({ default: () => null }));

vi.mock('chart.js', () => ({ Chart: class { destroy() {} }, registerables: [] }));
vi.mock('react-chartjs-2', () => new Proxy({}, { get: () => () => null }));

// Ensure TextEncoder/TextDecoder exist for libraries that expect them
// Use node:util versions when jsdom doesn't provide them
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextEncoder = (global as any).TextEncoder || TextEncoder;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextDecoder = (global as any).TextDecoder || TextDecoder;

// Provide a Map-backed Web Storage shim. jsdom's default implementation is
// missing on some environments (jsdom 27 regression) and individual tests
// rely on read-after-write behavior, so vi.fn() stubs aren't sufficient.
function createStorageShim(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
  } as Storage;
}
Object.defineProperty(window, 'localStorage', { value: createStorageShim(), configurable: true, writable: true });
Object.defineProperty(window, 'sessionStorage', { value: createStorageShim(), configurable: true, writable: true });
