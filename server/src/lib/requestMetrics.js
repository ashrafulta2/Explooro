/**
 * requestMetrics.js — in-process API latency and error-rate collector for System Health.
 *
 * WHY in-process: System Health used to return literal p50/p95/p99 and a 0.02% error rate. The
 * honest source is the requests this process actually served. It is a rolling window of the last
 * `capacity` responses, per process — so after a restart it is empty, and behind several nodes it
 * describes only the node that answered. `sample_size` is returned so the UI can say so.
 */

export function createRequestMetrics({ capacity = 2000 } = {}) {
  const durations = new Float64Array(capacity);
  const failures = new Uint8Array(capacity);
  let next = 0;
  let filled = 0;

  function record(durationMs, statusCode) {
    durations[next] = durationMs;
    failures[next] = statusCode >= 500 ? 1 : 0;
    next = (next + 1) % capacity;
    if (filled < capacity) filled += 1;
  }

  function snapshot() {
    if (filled === 0) {
      return { sample_size: 0, p50_ms: null, p95_ms: null, p99_ms: null, error_rate_pct: null };
    }
    const sorted = Array.from(durations.subarray(0, filled)).sort((a, b) => a - b);
    // Nearest-rank percentile.
    const at = (p) => sorted[Math.min(filled - 1, Math.max(0, Math.ceil((p / 100) * filled) - 1))];
    let errors = 0;
    for (let i = 0; i < filled; i += 1) errors += failures[i];
    const round = (n) => Math.round(n * 10) / 10;
    return {
      sample_size: filled,
      p50_ms: round(at(50)),
      p95_ms: round(at(95)),
      p99_ms: round(at(99)),
      error_rate_pct: Math.round((errors / filled) * 10000) / 100,
    };
  }

  return { record, snapshot };
}

/** Fastify plugin: times every response into `app.requestMetrics`. */
export default function requestMetricsPlugin(app, opts, done) {
  const metrics = opts.metrics ?? createRequestMetrics();
  app.decorate('requestMetrics', metrics);
  app.addHook('onResponse', (req, reply, next) => {
    metrics.record(reply.elapsedTime, reply.statusCode);
    next();
  });
  done();
}

// Not encapsulated, so the hook covers every route registered after it.
requestMetricsPlugin[Symbol.for('skip-override')] = true;
