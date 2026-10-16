/**
 * Build a log-safe summary of an error (including AxiosErrors).
 *
 * AxiosErrors carry config.headers (Poloniex `key` / `signature`), request and
 * socket objects. Logging them directly leaks credentials, so only an explicit
 * allowlist of scalar fields is returned here.
 *
 * @param {unknown} err
 * @returns {{message?: string, code?: string|number, status?: number, statusText?: string, poloniexCode?: string|number, poloniexMsg?: string}}
 */
export function toSafeErrorLog(err) {
  if (err === null || err === undefined) return { message: String(err) };
  if (typeof err !== 'object') return { message: String(err) };

  const body = err.response?.data;
  const bodyObj = body && typeof body === 'object' ? body : undefined;

  const safe = {
    message: err.message,
    code: err.code,
    status: err.response?.status,
    statusText: err.response?.statusText,
    poloniexCode: bodyObj?.code ?? err.poloniexCode,
    poloniexMsg: bodyObj?.msg ?? bodyObj?.message ?? err.poloniexMsg,
  };

  // Drop undefined fields to keep log lines compact.
  return Object.fromEntries(Object.entries(safe).filter(([, v]) => v !== undefined));
}

export default toSafeErrorLog;
