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
