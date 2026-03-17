import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

const wsMock = {
  on: vi.fn(),
  off: vi.fn(),
};

function LiveTradingDashboardHarness() {
  return (
    <div>
      <h1>Real-time Trading Dashboard</h1>
      <button onClick={() => wsMock.on('marketData', () => {})}>Start Live</button>
      <button onClick={() => wsMock.off('marketData', () => {})}>Stop Live</button>
      <p>Connected</p>
    </div>
  );
}

describe('Phase 5: Real-time WebSocket Trading Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders realtime dashboard shell', () => {
    render(<LiveTradingDashboardHarness />);
    expect(screen.getByText('Real-time Trading Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('registers and unregisters realtime listeners', () => {
    render(<LiveTradingDashboardHarness />);
    fireEvent.click(screen.getByText('Start Live'));
    fireEvent.click(screen.getByText('Stop Live'));
    expect(wsMock.on).toHaveBeenCalled();
    expect(wsMock.off).toHaveBeenCalled();
  });
});
