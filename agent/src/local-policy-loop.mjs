import { runDuePolicyTasks } from './local-policy-runner.mjs';

export const DEFAULT_POLICY_LOOP_INTERVAL_MS = 60_000;
export const MIN_POLICY_LOOP_INTERVAL_MS = 1_000;

function safeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : now || new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function resultSummary(result = {}) {
  return {
    status: result.status || null,
    mode: result.mode || null,
    observed_at: result.observed_at || null,
    due_count: result.due_count ?? null,
    planned_task_count: result.planned_task_count ?? null,
    ready_task_count: result.ready_task_count ?? null,
    dispatched_task_count: result.dispatched_task_count ?? null,
    blocked_task_count: result.blocked_task_count ?? null,
    result_count: result.result_count ?? null,
  };
}

export function normalizePolicyLoopOptions(input = {}) {
  const intervalMs = Math.max(
    MIN_POLICY_LOOP_INTERVAL_MS,
    safeInteger(input.intervalMs ?? input.interval_ms, DEFAULT_POLICY_LOOP_INTERVAL_MS)
  );
  return {
    interval_ms: intervalMs,
    limit: Math.max(0, safeInteger(input.limit, 50)),
    check_readiness: Boolean(input.checkReadiness ?? input.check_readiness ?? input.dispatch),
    dispatch: Boolean(input.dispatch),
    mark_ticks: input.markTicks ?? input.mark_ticks ?? input.mark !== false,
    verify_receipt: input.verifyReceipt ?? input.verify_receipt ?? true,
    verify_live_grant: Boolean(input.verifyHyperliquidLiveGrant ?? input.verify_live_grant),
    require_signer_probe: Boolean(input.requireSignerProbe ?? input.require_signer_probe),
    signer_probe_timeout_ms: Math.max(
      1,
      safeInteger(input.signerProbeTimeoutMs ?? input.signer_probe_timeout_ms, 3000)
    ),
    timeout_ms: Math.max(1, safeInteger(input.timeoutMs ?? input.timeout_ms, 30_000)),
    simulated: input.simulated !== false,
  };
}

export function createLocalPolicyLoop(options = {}) {
  const {
    loadContext = async () => ({}),
    runOnce = runDuePolicyTasks,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    now = () => new Date(),
  } = options;

  let timer = null;
  let activeOptions = normalizePolicyLoopOptions(options.defaultOptions || {});
  let startedAt = null;
  let stoppedAt = null;
  let inFlight = false;
  let runCount = 0;
  let lastRun = null;

  function status() {
    return {
      status: timer ? 'running' : 'stopped',
      running: Boolean(timer),
      in_flight: inFlight,
      started_at: startedAt,
      stopped_at: stoppedAt,
      run_count: runCount,
      options: { ...activeOptions },
      last_run: lastRun,
    };
  }

  async function runNow(input = {}) {
    const reason = typeof input === 'string' ? input : input.reason || 'manual';
    const overrides = typeof input === 'string' ? {} : input;
    if (inFlight) {
      return {
        status: 'skipped',
        code: 'POLICY_LOOP_IN_FLIGHT',
        message: 'Policy loop run is already in flight.',
        policy_loop: status(),
      };
    }

    const runStartedAt = nowIso(now);
    const effectiveOptions = normalizePolicyLoopOptions({ ...activeOptions, ...overrides });
    const runNowDate = new Date(runStartedAt);
    inFlight = true;
    try {
      const context = await loadContext();
      const result = await runOnce({
        ...context,
        now: runNowDate,
        limit: effectiveOptions.limit,
        checkReadiness: effectiveOptions.check_readiness,
        dispatch: effectiveOptions.dispatch,
        markTicks: effectiveOptions.mark_ticks,
        timeoutMs: effectiveOptions.timeout_ms,
        verifyReceipt: effectiveOptions.verify_receipt,
        verifyHyperliquidLiveGrant: effectiveOptions.verify_live_grant,
        requireSignerProbe: effectiveOptions.require_signer_probe,
        signerProbeTimeoutMs: effectiveOptions.signer_probe_timeout_ms,
        simulated: effectiveOptions.simulated,
      });
      runCount += 1;
      lastRun = {
        status: 'ok',
        reason,
        started_at: runStartedAt,
        finished_at: nowIso(now),
        summary: resultSummary(result),
      };
      return {
        status: 'ok',
        reason,
        policy_loop: status(),
        result,
      };
    } catch (error) {
      runCount += 1;
      lastRun = {
        status: 'error',
        reason,
        started_at: runStartedAt,
        finished_at: nowIso(now),
        code: 'POLICY_LOOP_RUN_FAILED',
        message: error?.message || String(error),
      };
      return {
        status: 'error',
        code: 'POLICY_LOOP_RUN_FAILED',
        message: error?.message || String(error),
        reason,
        policy_loop: status(),
      };
    } finally {
      inFlight = false;
    }
  }

  function start(input = {}) {
    const nextOptions = normalizePolicyLoopOptions({ ...activeOptions, ...input });
    if (timer) {
      activeOptions = nextOptions;
      return {
        status: 'ok',
        already_running: true,
        policy_loop: status(),
      };
    }
    activeOptions = nextOptions;
    startedAt = nowIso(now);
    stoppedAt = null;
    timer = setIntervalImpl(() => {
      void runNow({ reason: 'interval' });
    }, activeOptions.interval_ms);
    timer?.unref?.();
    if (input.runImmediately || input.run_immediately) {
      void runNow({ reason: 'start' });
    }
    return {
      status: 'ok',
      policy_loop: status(),
    };
  }

  function stop(input = {}) {
    if (!timer) {
      return {
        status: 'ok',
        already_stopped: true,
        policy_loop: status(),
      };
    }
    clearIntervalImpl(timer);
    timer = null;
    stoppedAt = nowIso(now);
    return {
      status: 'ok',
      reason: input.reason || 'manual',
      policy_loop: status(),
    };
  }

  return {
    start,
    stop,
    status,
    runNow,
  };
}
