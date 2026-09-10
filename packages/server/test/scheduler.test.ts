import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerJob,
  listJobs,
  runJob,
  schedulerEnabled,
  isSchedulerRunning,
  __resetScheduler,
} from '../src/services/scheduler';

// The scheduler's JobRun write is best-effort and swallows errors, so these
// tests exercise the registry/run logic without a database (the dummy
// DATABASE_URL in vitest.config makes the Prisma import constructible).

describe('schedulerEnabled', () => {
  const saved = process.env.SCHEDULER_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = saved;
  });

  it('defaults to enabled', () => {
    delete process.env.SCHEDULER_ENABLED;
    expect(schedulerEnabled()).toBe(true);
  });

  it('is disabled only by an explicit "false"', () => {
    process.env.SCHEDULER_ENABLED = 'false';
    expect(schedulerEnabled()).toBe(false);
    process.env.SCHEDULER_ENABLED = 'FALSE';
    expect(schedulerEnabled()).toBe(false);
    process.env.SCHEDULER_ENABLED = 'true';
    expect(schedulerEnabled()).toBe(true);
  });
});

describe('job registry', () => {
  beforeEach(() => __resetScheduler());
  afterEach(() => __resetScheduler());

  it('registers a job and reports it via listJobs', () => {
    registerJob({ name: 'nightly', intervalMs: 60_000, handler: async () => ({ recordsProcessed: 0 }) });
    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('nightly');
    expect(jobs[0].intervalMs).toBe(60_000);
    expect(jobs[0].running).toBe(false);
    expect(jobs[0].lastStatus).toBeNull();
    expect(jobs[0].lastRunAt).toBeNull();
  });

  it('schedules runOnStart jobs immediately and others one interval out', () => {
    const now = Date.now();
    registerJob({ name: 'immediate', intervalMs: 10_000, runOnStart: true, handler: async () => {} });
    registerJob({ name: 'delayed', intervalMs: 10_000, handler: async () => {} });
    const jobs = Object.fromEntries(listJobs().map((j) => [j.name, j]));
    // runOnStart → nextRunAt is ~now; delayed → nextRunAt is ~now + interval.
    expect(new Date(jobs.immediate.nextRunAt).getTime()).toBeLessThanOrEqual(now + 50);
    expect(new Date(jobs.delayed.nextRunAt).getTime()).toBeGreaterThan(now + 5_000);
  });

  it('replaces a job registered under the same name', () => {
    registerJob({ name: 'dup', intervalMs: 1, handler: async () => {} });
    registerJob({ name: 'dup', intervalMs: 2, handler: async () => {} });
    expect(listJobs()).toHaveLength(1);
    expect(listJobs()[0].intervalMs).toBe(2);
  });
});

describe('runJob', () => {
  beforeEach(() => __resetScheduler());
  afterEach(() => __resetScheduler());

  it('returns the handler result and records SUCCESS', async () => {
    registerJob({ name: 'ok', intervalMs: 1000, handler: async () => ({ recordsProcessed: 7, message: 'done' }) });
    const res = await runJob('ok');
    expect(res.recordsProcessed).toBe(7);
    expect(res.message).toBe('done');
    const job = listJobs().find((j) => j.name === 'ok')!;
    expect(job.lastStatus).toBe('SUCCESS');
    expect(job.lastProcessed).toBe(7);
    expect(job.lastError).toBeNull();
    expect(job.running).toBe(false);
    expect(job.lastRunAt).not.toBeNull();
  });

  it('treats a void handler as zero records processed', async () => {
    registerJob({ name: 'void', intervalMs: 1000, handler: async () => {} });
    const res = await runJob('void');
    expect(res.recordsProcessed).toBe(0);
    expect(listJobs().find((j) => j.name === 'void')!.lastStatus).toBe('SUCCESS');
  });

  it('captures a handler failure without throwing', async () => {
    registerJob({
      name: 'boom',
      intervalMs: 1000,
      handler: async () => { throw new Error('kaboom'); },
    });
    const res = await runJob('boom');
    expect(res.recordsProcessed).toBe(0);
    expect(res.message).toContain('kaboom');
    const job = listJobs().find((j) => j.name === 'boom')!;
    expect(job.lastStatus).toBe('FAILED');
    expect(job.lastError).toBe('kaboom');
    expect(job.running).toBe(false); // cleared even on failure
  });

  it('reports an unknown job name', async () => {
    const res = await runJob('does-not-exist');
    expect(res.recordsProcessed).toBe(0);
    expect(res.message).toContain('unknown job');
  });

  it('skips a job that is already running (overlap guard)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    registerJob({
      name: 'slow',
      intervalMs: 1000,
      handler: async () => { await gate; return { recordsProcessed: 3 }; },
    });

    const first = runJob('slow');            // starts, blocks on the gate
    const second = await runJob('slow');     // returns immediately: already running
    expect(second.recordsProcessed).toBe(0);
    expect(second.message).toContain('already running');

    release();
    const firstRes = await first;
    expect(firstRes.recordsProcessed).toBe(3);
  });

  it('pushes nextRunAt one interval into the future after a run', async () => {
    registerJob({ name: 'reschedule', intervalMs: 30_000, runOnStart: true, handler: async () => {} });
    await runJob('reschedule');
    const job = listJobs().find((j) => j.name === 'reschedule')!;
    expect(new Date(job.nextRunAt).getTime()).toBeGreaterThan(Date.now() + 20_000);
  });
});

describe('scheduler lifecycle', () => {
  beforeEach(() => __resetScheduler());
  afterEach(() => __resetScheduler());

  it('is not running after a reset', () => {
    expect(isSchedulerRunning()).toBe(false);
  });
});
