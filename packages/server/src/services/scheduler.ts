// ─── Background job scheduler (§19 campaigns, §10 payouts, §29 webhook retry,
// §37 retention purge, §12 low-stock, stored-value & loyalty expiry) ──────────
// Dependency-free, in-process tick scheduler. No cron library and no external
// queue: a single setInterval advances a job registry, running each job when it
// falls due and recording a JobRun row for observability.
//
// SCALE-OUT: jobs mutate state, so enable the scheduler on exactly ONE instance
// via SCHEDULER_ENABLED (default true). Overlap is guarded in-process and every
// job is written to be idempotent, but a single leader avoids duplicate side
// effects across replicas. JobRun writes are best-effort: a logging failure can
// never break the tick.

import { prisma } from '../db/client.js';
import { captureException } from './observability.js';

export interface JobResult {
  recordsProcessed?: number;
  message?: string;
}

export interface Job {
  /** Stable, unique job name (also the JobRun.jobName). */
  name: string;
  /** How often the job is eligible to run. */
  intervalMs: number;
  /** Run once immediately on startScheduler() instead of after one interval. */
  runOnStart?: boolean;
  handler: () => Promise<JobResult | void>;
}

interface JobState {
  job: Job;
  lastRunAt: number | null;
  nextRunAt: number;
  running: boolean;
  lastStatus?: 'SUCCESS' | 'FAILED';
  lastError?: string | null;
  lastProcessed?: number;
}

const registry = new Map<string, JobState>();
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

function tickMs(): number {
  const v = Number(process.env.SCHEDULER_TICK_MS);
  return Number.isFinite(v) && v >= 1000 ? v : 15000;
}

/** True unless SCHEDULER_ENABLED is explicitly 'false'. */
export function schedulerEnabled(): boolean {
  return String(process.env.SCHEDULER_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

/** Register (or replace) a job. Call before startScheduler(). */
export function registerJob(job: Job): void {
  const now = Date.now();
  registry.set(job.name, {
    job,
    lastRunAt: null,
    nextRunAt: job.runOnStart ? now : now + job.intervalMs,
    running: false,
  });
}

/** Snapshot of every registered job and its last-run state (for /api/system). */
export function listJobs() {
  return [...registry.values()].map((s) => ({
    name: s.job.name,
    intervalMs: s.job.intervalMs,
    lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
    nextRunAt: new Date(s.nextRunAt).toISOString(),
    running: s.running,
    lastStatus: s.lastStatus ?? null,
    lastError: s.lastError ?? null,
    lastProcessed: s.lastProcessed ?? 0,
  }));
}

async function recordRun(
  name: string,
  status: 'SUCCESS' | 'FAILED',
  recordsProcessed: number,
  durationMs: number,
  error: string | null,
): Promise<void> {
  try {
    await prisma.jobRun.create({
      data: { jobName: name, status, recordsProcessed, durationMs, error, finishedAt: new Date() },
    });
  } catch {
    // Best-effort observability; never let a JobRun write break the scheduler.
  }
}

/** Run a registered job now (guarded against overlap). Records a JobRun. */
export async function runJob(name: string): Promise<JobResult> {
  const state = registry.get(name);
  if (!state) return { recordsProcessed: 0, message: `unknown job: ${name}` };
  if (state.running) return { recordsProcessed: 0, message: 'skipped: already running' };

  state.running = true;
  const startedAt = Date.now();
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
  let processed = 0;
  let errorMsg: string | null = null;

  try {
    const result = (await state.job.handler()) || {};
    processed = result.recordsProcessed ?? 0;
    state.lastStatus = 'SUCCESS';
    state.lastError = null;
    state.lastProcessed = processed;
    return { recordsProcessed: processed, message: result.message };
  } catch (e: any) {
    status = 'FAILED';
    errorMsg = String(e?.message || e);
    state.lastStatus = 'FAILED';
    state.lastError = errorMsg;
    state.lastProcessed = 0;
    captureException(e);
    console.error(`[scheduler] job "${name}" failed:`, errorMsg);
    return { recordsProcessed: 0, message: `error: ${errorMsg}` };
  } finally {
    const durationMs = Date.now() - startedAt;
    state.running = false;
    state.lastRunAt = startedAt;
    state.nextRunAt = Date.now() + state.job.intervalMs;
    await recordRun(name, status, processed, durationMs, errorMsg);
  }
}

/** Advance every due job. Fire-and-forget; runJob guards overlap + logging. */
async function tick(): Promise<void> {
  const now = Date.now();
  for (const state of registry.values()) {
    if (!state.running && now >= state.nextRunAt) {
      void runJob(state.job.name);
    }
  }
}

/** Start the tick loop. No-op if already started or disabled via env. */
export function startScheduler(): void {
  if (started) return;
  if (!schedulerEnabled()) {
    console.log('[scheduler] disabled via SCHEDULER_ENABLED=false');
    return;
  }
  started = true;
  timer = setInterval(() => {
    void tick();
  }, tickMs());
  // Never hold the process open just for the scheduler (HTTP server owns lifetime).
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
  console.log(`[scheduler] started — ${registry.size} job(s), tick ${tickMs()}ms`);
  void tick(); // immediate first pass so runOnStart jobs fire without waiting
}

/** Stop the tick loop (called during graceful shutdown). */
export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export function isSchedulerRunning(): boolean {
  return started;
}

/** Test helper: clear all state so the registry can be rebuilt between cases. */
export function __resetScheduler(): void {
  stopScheduler();
  registry.clear();
}
