/**
 * Idempotency Manager
 * 
 * Prevents duplicate database mutations from network retries, double submits,
 * or concurrent tool calls using client-supplied or derived request IDs.
 */

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map();

/**
 * Periodically cleans up expired records to keep memory bounded.
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      cache.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpired, 5 * 60 * 1000).unref();

/**
 * Checks if a requestId has already been processed or is currently executing.
 * @param {string} requestId 
 * @returns {{ exists: boolean, status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED', result?: any }}
 */
function checkIdempotency(requestId) {
  if (!requestId) return { exists: false };
  const entry = cache.get(requestId);
  if (!entry) return { exists: false };

  // Expired check
  if (Date.now() - entry.timestamp > IDEMPOTENCY_TTL_MS) {
    cache.delete(requestId);
    return { exists: false };
  }

  return {
    exists: true,
    status: entry.status,
    result: entry.result,
  };
}

/**
 * Marks a requestId as IN_PROGRESS.
 * @param {string} requestId 
 */
function lockRequestId(requestId) {
  if (!requestId) return;
  cache.set(requestId, {
    status: 'IN_PROGRESS',
    timestamp: Date.now(),
    result: null,
  });
}

/**
 * Stores the successful result of a mutation for a given requestId.
 * @param {string} requestId 
 * @param {any} result 
 */
function saveIdempotencyResult(requestId, result) {
  if (!requestId) return;
  cache.set(requestId, {
    status: 'COMPLETED',
    timestamp: Date.now(),
    result,
  });
}

/**
 * Marks requestId as failed so that safe retries can be attempted.
 * @param {string} requestId 
 * @param {string} error 
 */
function markIdempotencyFailed(requestId, error) {
  if (!requestId) return;
  cache.set(requestId, {
    status: 'FAILED',
    timestamp: Date.now(),
    result: { error },
  });
}

/**
 * Clears the cache (primarily for tests).
 */
function clearIdempotencyCache() {
  cache.clear();
}

module.exports = {
  checkIdempotency,
  lockRequestId,
  saveIdempotencyResult,
  markIdempotencyFailed,
  clearIdempotencyCache,
};
