/**
 * DB-aware readiness check for the /api/v1/health endpoint.
 *
 * Returns { status, body } — caller writes these to the HTTP response.
 * Internal error details are logged server-side and never exposed to the caller.
 *
 * Distinct from liveness (GET /health):
 *   liveness  → is the process alive?           (no DB)
 *   readiness → can the process serve requests?  (pings DB)
 *
 * Load balancer configuration:
 *   liveness probe  → GET /health
 *   readiness probe → GET /api/v1/health
 */
export async function checkReadiness(db) {
  try {
    await db.ping();
    return { status: 200, body: { ok: true, db: 'connected' } };
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'readiness_check_failed',
      message: err?.message ?? 'unknown error',
    }));
    return { status: 503, body: { ok: false, db: 'unavailable' } };
  }
}
