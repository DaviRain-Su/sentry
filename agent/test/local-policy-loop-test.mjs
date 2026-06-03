import assert from 'node:assert/strict';
import { createLocalPolicyLoop, normalizePolicyLoopOptions } from '../src/local-policy-loop.mjs';

const normalized = normalizePolicyLoopOptions({
  interval_ms: 10,
  dispatch: true,
  mark: false,
});
assert.equal(normalized.interval_ms, 1000);
assert.equal(normalized.dispatch, true);
assert.equal(normalized.check_readiness, true);
assert.equal(normalized.mark_ticks, false);

let timerCallback = null;
let timerDelay = null;
let clearedTimer = null;
const timerHandle = {
  unrefCalled: false,
  unref() {
    this.unrefCalled = true;
  },
};
const runInputs = [];
const loop = createLocalPolicyLoop({
  now: () => new Date('2026-06-03T00:00:00.000Z'),
  setIntervalImpl: (callback, delay) => {
    timerCallback = callback;
    timerDelay = delay;
    return timerHandle;
  },
  clearIntervalImpl: (handle) => {
    clearedTimer = handle;
  },
  loadContext: async () => ({ policyStore: { status: 'ok', policies: [] } }),
  runOnce: async (input) => {
    runInputs.push(input);
    return {
      status: 'ok',
      mode: input.dispatch ? 'dispatch' : input.checkReadiness ? 'readiness' : 'plan',
      observed_at: '2026-06-03T00:00:00.000Z',
      due_count: 1,
      planned_task_count: 1,
      ready_task_count: input.checkReadiness ? 1 : 0,
      dispatched_task_count: input.dispatch ? 1 : 0,
      blocked_task_count: 0,
      result_count: 1,
    };
  },
});

assert.equal(loop.status().status, 'stopped');
const started = loop.start({
  interval_ms: 1500,
  check_readiness: true,
  dispatch: false,
});
assert.equal(started.status, 'ok');
assert.equal(loop.status().status, 'running');
assert.equal(timerDelay, 1500);
assert.equal(timerHandle.unrefCalled, true);
assert.equal(typeof timerCallback, 'function');

const run = await loop.runNow({ reason: 'test-run' });
assert.equal(run.status, 'ok');
assert.equal(run.reason, 'test-run');
assert.equal(run.result.mode, 'readiness');
assert.equal(runInputs.length, 1);
assert.equal(runInputs[0].markTicks, true);
assert.equal(run.policy_loop.last_run.summary.ready_task_count, 1);

const startedAgain = loop.start({ dispatch: true });
assert.equal(startedAgain.status, 'ok');
assert.equal(startedAgain.already_running, true);
assert.equal(loop.status().options.dispatch, true);

const stopped = loop.stop({ reason: 'test-stop' });
assert.equal(stopped.status, 'ok');
assert.equal(stopped.reason, 'test-stop');
assert.equal(loop.status().status, 'stopped');
assert.equal(clearedTimer, timerHandle);

let releaseInFlight;
const inFlightLoop = createLocalPolicyLoop({
  now: () => new Date('2026-06-03T00:00:01.000Z'),
  loadContext: async () => ({}),
  runOnce: async () =>
    new Promise((resolve) => {
      releaseInFlight = () =>
        resolve({
          status: 'ok',
          mode: 'plan',
          observed_at: '2026-06-03T00:00:01.000Z',
        });
    }),
});
const firstRun = inFlightLoop.runNow({ reason: 'slow' });
const skipped = await inFlightLoop.runNow({ reason: 'overlap' });
assert.equal(skipped.status, 'skipped');
assert.equal(skipped.code, 'POLICY_LOOP_IN_FLIGHT');
releaseInFlight();
assert.equal((await firstRun).status, 'ok');
assert.equal(inFlightLoop.status().run_count, 1);

const errorLoop = createLocalPolicyLoop({
  now: () => new Date('2026-06-03T00:00:02.000Z'),
  loadContext: async () => ({}),
  runOnce: async () => {
    throw new Error('boom');
  },
});
const failed = await errorLoop.runNow({ reason: 'error-case' });
assert.equal(failed.status, 'error');
assert.equal(failed.code, 'POLICY_LOOP_RUN_FAILED');
assert.equal(errorLoop.status().last_run.message, 'boom');

console.log('ALL LOCAL POLICY LOOP TESTS PASS');
