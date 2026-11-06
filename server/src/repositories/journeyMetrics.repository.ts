/**
 * journeyMetrics.repository.ts — the journey_step_events table (migration 103, Prompt 13.7).
 *
 * Written by the Next-Step engine, read by the metrics page. Every statement is static, so
 * `npm run check:sql` PREPAREs it against the real schema.
 */

export type StepEvent = 'REACHED' | 'COMPLETED';

/**
 * Records the first sighting of each (step, event) for one user. Re-sending one already recorded is
 * a no-op, so the caller may send every done step on every computation.
 */
export async function recordStepEvents(db, userId: number, journey: string, events: { step_id: string; event: StepEvent }[]): Promise<void> {
  if (events.length === 0) return;
  await db.query(
    `INSERT INTO journey_step_events (user_id, journey, step_id, event)
     SELECT $1, $2, e.step_id, e.event
     FROM unnest($3::text[], $4::text[]) AS e(step_id, event)
     ON CONFLICT (user_id, journey, step_id, event) DO NOTHING`,
    [userId, journey, events.map((e) => e.step_id), events.map((e) => e.event)]
  );
}

export interface StepAggregateRow {
  journey: string;
  step_id: string;
  /** Users with any event on the step. */
  reached: number;
  /** Users with a REACHED row: equals the number of REACHED events for the step. */
  reached_events: number;
  /** Users with a COMPLETED row: equals the number of COMPLETED events for the step. */
  completed: number;
  /** Reached at least `abandonAfterDays` ago and still not completed. */
  abandoned: number;
  /** Users whose outcome is known: completed, or abandoned. The base of the abandon rate. */
  settled: number;
  /** Users with both rows, completed after reaching: the base of the median. */
  timed: number;
  median_seconds: number | null;
}

/**
 * One row per (journey, step) that has any event. WHY the aggregation is in SQL: the table grows with
 * users x steps, and the answer is a few dozen rows.
 */
export async function stepAggregates(db, abandonAfterDays: number): Promise<StepAggregateRow[]> {
  const { rows } = await db.query(
    `WITH pairs AS (
       SELECT journey, step_id, user_id,
              MIN(occurred_at) FILTER (WHERE event = 'REACHED') AS reached_at,
              MIN(occurred_at) FILTER (WHERE event = 'COMPLETED') AS completed_at
       FROM journey_step_events
       GROUP BY journey, step_id, user_id
     )
     SELECT journey, step_id,
            COUNT(*)::int AS reached,
            COUNT(reached_at)::int AS reached_events,
            COUNT(completed_at)::int AS completed,
            COUNT(*) FILTER (WHERE completed_at IS NULL AND reached_at < now() - make_interval(days => $1::int))::int AS abandoned,
            COUNT(*) FILTER (WHERE completed_at IS NOT NULL OR reached_at < now() - make_interval(days => $1::int))::int AS settled,
            COUNT(*) FILTER (WHERE reached_at IS NOT NULL AND completed_at >= reached_at)::int AS timed,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM completed_at - reached_at))
              FILTER (WHERE reached_at IS NOT NULL AND completed_at >= reached_at) AS median_seconds
     FROM pairs
     GROUP BY journey, step_id`,
    [abandonAfterDays]
  );
  return rows.map((r) => ({ ...r, median_seconds: r.median_seconds == null ? null : Number(r.median_seconds) }));
}

/** Raw event counts, so the page can show that its per-step numbers add up to the table. */
export async function eventTotals(db): Promise<{ reached_events: number; completed_events: number }> {
  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE event = 'REACHED')::int AS reached_events,
            COUNT(*) FILTER (WHERE event = 'COMPLETED')::int AS completed_events
     FROM journey_step_events`
  );
  return { reached_events: rows[0]?.reached_events ?? 0, completed_events: rows[0]?.completed_events ?? 0 };
}

/** Per role: how many users hold it, and how many switched the next-step card off. */
export async function optOutByRole(db): Promise<{ role: string; users: number; opted_out: number }[]> {
  const { rows } = await db.query(
    `SELECT r.key AS role,
            COUNT(DISTINCT ur.user_id)::int AS users,
            COUNT(DISTINCT ur.user_id) FILTER (WHERE up.show_next_steps = false)::int AS opted_out
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     LEFT JOIN user_profiles up ON up.user_id = ur.user_id
     GROUP BY r.key`
  );
  return rows;
}
