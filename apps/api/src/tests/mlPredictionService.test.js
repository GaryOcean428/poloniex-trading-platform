import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args) => spawnMock(...args)
}));

const createMockProcess = ({ triggerErrorCode = null, stdout = '{}', exitCode = 0 } = {}) => {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdin = {
    write: vi.fn(),
    end: vi.fn()
  };

  queueMicrotask(() => {
    if (triggerErrorCode) {
      const err = new Error(`spawn ${triggerErrorCode}`);
      err.code = triggerErrorCode;
      process.emit('error', err);
      return;
    }

    if (stdout) {
      process.stdout.emit('data', Buffer.from(stdout));
    }
    process.emit('close', exitCode);
  });

  return process;
};

describe('MLPredictionService', () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    delete process.env.PYTHON_PATH;
  });

  it('falls back from python3.11 to python3 when python3.11 is unavailable', async () => {
    spawnMock
      .mockImplementationOnce(() => createMockProcess({ triggerErrorCode: 'ENOENT' }))
      .mockImplementationOnce(() =>
        createMockProcess({
          stdout: JSON.stringify({ signal: 'HOLD', strength: 0.1, reason: 'ok' })
        })
      );

    const { default: mlPredictionService } = await import('../services/mlPredictionService.js');
    const result = await mlPredictionService.getTradingSignal('BTC_USDT', [{ close: 100 }], 100);

    expect(result.signal).toBe('HOLD');
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][0]).toBe('python3.11');
    expect(spawnMock.mock.calls[1][0]).toBe('python3');
  });

  it('returns clear error when no python interpreter is available', async () => {
    spawnMock.mockImplementation(() => createMockProcess({ triggerErrorCode: 'ENOENT' }));
    const { default: mlPredictionService } = await import('../services/mlPredictionService.js');

    await expect(
      mlPredictionService.getMultiHorizonPredictions('BTC_USDT', [{ close: 100 }])
    ).rejects.toThrow('no valid Python interpreter found');
  });
});
