/**
 * T-v1.0-09 · In-process metrics counters.
 *
 * Lightweight counter store that emits values on demand via [snapshot] or
 * to a periodic JSON line via [emitJsonLine]. No external dependencies; the
 * production deployment is expected to scrape these via a sidecar or pull
 * them from a `/metrics` endpoint.
 *
 * Counters tracked (per [system-design § 8 metrics-to-watch] and the runbook):
 *   - match_count
 *   - match_disconnect_count          (used to derive disconnect_rate)
 *   - sign_in_failure_count           (used to derive sign_in_failure_rate)
 *   - account_deletion_count
 *   - bridge_error_count              (used to derive bridge_error_rate)
 *   - match_history_buffer_dropped_total
 *
 * The counter set is closed: callers cannot register arbitrary names, which
 * keeps the metric surface deliberate and reviewable.
 */

const COUNTERS = [
  "match_count",
  "match_disconnect_count",
  "sign_in_failure_count",
  "account_deletion_count",
  "bridge_error_count",
  "match_history_buffer_dropped_total",
] as const;

export type CounterName = (typeof COUNTERS)[number];

const counts: Record<CounterName, number> = Object.fromEntries(
  COUNTERS.map((c) => [c, 0])
) as Record<CounterName, number>;

/** Increment a named counter by `n` (default 1). */
export function increment(name: CounterName, n: number = 1): void {
  counts[name] += n;
}

/** Read all counters as a snapshot map. */
export function snapshot(): Record<CounterName, number> {
  return { ...counts };
}

/** Reset every counter to zero — for tests only. */
export function reset(): void {
  for (const c of COUNTERS) counts[c] = 0;
}

/** Emit a single JSON line with the snapshot timestamped — for periodic flush. */
export function emitJsonLine(out: NodeJS.WritableStream = process.stdout): void {
  const line = {
    ts: new Date().toISOString(),
    event: "metrics",
    ...counts,
  };
  out.write(JSON.stringify(line) + "\n");
}

/** Counter names — for tests and tooling. */
export const counterNames: ReadonlyArray<CounterName> = COUNTERS;
