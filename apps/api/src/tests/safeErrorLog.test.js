import { describe, it, expect } from 'vitest';
import { toSafeErrorLog } from '../utils/safeErrorLog.js';

describe('toSafeErrorLog', () => {
  it('omits config, headers, request and socket from axios-like errors', () => {
    const err = new Error('Request failed with status code 401');
    err.code = 'ERR_BAD_REQUEST';
    err.config = { headers: { key: 'API_KEY_VALUE', signature: 'SIGNATURE_VALUE' } };
    err.request = { socket: { secret: 'x' } };
    err.response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'set-cookie': 'abc' },
      data: { code: 21000, msg: 'Illegal of apiState' },
    };

    const safe = toSafeErrorLog(err);

    expect(safe).toEqual({
      message: 'Request failed with status code 401',
      code: 'ERR_BAD_REQUEST',
      status: 401,
      statusText: 'Unauthorized',
      poloniexCode: 21000,
      poloniexMsg: 'Illegal of apiState',
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('API_KEY_VALUE');
    expect(serialized).not.toContain('SIGNATURE_VALUE');
  });

  it('handles non-object errors', () => {
    expect(toSafeErrorLog('boom')).toEqual({ message: 'boom' });
    expect(toSafeErrorLog(undefined)).toEqual({ message: 'undefined' });
  });
});
