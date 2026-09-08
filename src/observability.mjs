// Expected input/content outcomes stay visible without paging the operator.
const expected = new Set(['NONE', 'NO_MATCHES', 'EMPTY_PLAYLIST', 'PLAYLIST_TOO_LARGE', 'PLAYLIST_UNAVAILABLE', 'SOURCE_LOGIN_REQUIRED', 'SOURCE_INCONSISTENT', 'INVALID_URL', 'INVALID_PLAYLIST', 'INVALID_SOURCE', 'INVALID_NAME', 'INVALID_REQUEST', 'UNAUTHORIZED', 'NOT_FOUND']);
export function isOperationalFailure(code) { return Boolean(code) && !expected.has(code); }

export function outcomeFields(status, code = 'NONE') {
  return { outcome: 1, completedJobs: Number(status === 'COMPLETE'), partialJobs: Number(status === 'PARTIAL'), failedJobs: Number(status === 'FAILED'), operationalFailure: Number(isOperationalFailure(code)) };
}

export function errorType(error) {
  return ['TimeoutError', 'AbortError', 'ProtocolError', 'TargetCloseError', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(error?.name) ? error.name : 'Error';
}

const labels = new Set(['event', 'component', 'requestId', 'apiRequestId', 'messageId', 'jobId', 'source', 'status', 'code', 'errorType', 'stage', 'method', 'route', 'probe', 'testId', 'version']);
const numbers = new Set(['outcome', 'completedJobs', 'partialJobs', 'failedJobs', 'operationalFailure', 'tracks', 'matched', 'elapsedMs', 'queueWaitMs', 'receiveCount', 'collectedCount', 'displayedCount', 'rounds', 'statusCode', 'availabilityFailure', 'testFailure']);
export function structuredLog(entry, write = line => process.stdout.write(line)) {
  const safe = { service: 'karaokekonverter', timestamp: new Date().toISOString() };
  for (const [key, value] of Object.entries(entry)) {
    if (labels.has(key) && typeof value === 'string' && /^[A-Za-z0-9_./:$ -]{1,160}$/.test(value)) safe[key] = value;
    if (numbers.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) safe[key] = value;
  }
  // A single raw JSON line: metric filters address top-level fields, not a
  // console message envelope. No bodies, URLs, headers, keys or raw exceptions.
  write(`${JSON.stringify(safe)}\n`);
}
export function scopedLog(log, context) { return entry => log({ ...entry, ...context }); }
