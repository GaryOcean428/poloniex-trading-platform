import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockWebSocketService = {
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockLiveDataService = {
  start: vi.fn(),
  stop: vi.fn(),
};

const mockMlService = {
  predictWithMLModel: vi.fn(),
};

const mockDqnService = {
  createDQNAction: vi.fn(),
};

function IntegrationHarness() {
  return (
    <div>
      <h1>Poloniex Trading Platform</h1>
      <button onClick={() => mockWebSocketService.connect()}>Connect</button>
      <button onClick={() => mockLiveDataService.start()}>Start Live Data</button>
      <button onClick={() => mockMlService.predictWithMLModel()}>Get Prediction</button>
      <button onClick={() => mockDqnService.createDQNAction()}>Get Action</button>
    </div>
  );
}

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render integration harness', () => {
    render(<IntegrationHarness />);
    expect(screen.getByText(/Poloniex Trading Platform/i)).toBeInTheDocument();
  });

  it('should trigger websocket and live data startup hooks', () => {
    render(<IntegrationHarness />);
    fireEvent.click(screen.getByText('Connect'));
    fireEvent.click(screen.getByText('Start Live Data'));
    expect(mockWebSocketService.connect).toHaveBeenCalledTimes(1);
    expect(mockLiveDataService.start).toHaveBeenCalledTimes(1);
  });

  it('should trigger ML and DQN actions', () => {
    render(<IntegrationHarness />);
    fireEvent.click(screen.getByText('Get Prediction'));
    fireEvent.click(screen.getByText('Get Action'));
    expect(mockMlService.predictWithMLModel).toHaveBeenCalledTimes(1);
    expect(mockDqnService.createDQNAction).toHaveBeenCalledTimes(1);
  });
});
