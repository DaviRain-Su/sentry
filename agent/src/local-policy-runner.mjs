import { validateAgentTask } from '../../core/agent-task.js';
import { dispatchAgentTask } from './agent-dispatcher.mjs';
import { verifyDispatchReceipt } from './dispatch-receipt-verifier.mjs';
import { getLocalDispatchReadiness } from './local-dispatch-readiness.mjs';
import { resolveAgentDispatchCommand } from './local-agent-registry.mjs';
import { markLocalPolicyTick } from './local-policy-store.mjs';
import { buildDuePolicyTaskPlan } from './local-policy-task-planner.mjs';
import {
  evaluateLocalPolicyRiskGuard,
  localPolicyRiskGuardRequired,
} from './local-policy-risk-guard.mjs';
import {
  evaluateLocalPolicyTriggerGuard,
  localPolicyTriggerGuardRequired,
} from './local-policy-trigger-guard.mjs';

const SUPPORTED_POLICY_ACTIONS = {
  okx: ['place_order'],
  hyperliquid: ['place_order'],
  'solana-mainnet': ['submit_tx'],
  'ethereum-mainnet': ['submit_tx'],
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function numericValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function policyConstraint(policy = {}, ...keys) {
  for (const key of keys) {
    if (policy.constraints?.[key] !== undefined && policy.constraints?.[key] !== null) {
      return policy.constraints[key];
    }
  }
  return null;
}

function taskCapabilities(task = {}) {
  return [
    ...list(task.constraints?.capabilities_required),
    ...list(task.authorization?.capabilities_required),
  ];
}

function taskVenueId(task = {}) {
  return (
    task.venue_id ||
    task.policy_context?.venue_id ||
    task.policy_context?.venue ||
    task.authorization?.venue_id ||
    null
  );
}

function taskNotional(task = {}) {
  const constraints = task.constraints || {};
  const params = task.action?.params || {};
  const explicit = numericValue(
    constraints.max_notional_usd ||
      constraints.max_quote_amount ||
      params.max_notional_usd ||
      params.max_quote_amount
  );
  if (explicit !== null) return { status: 'ok', amount: explicit, source: 'explicit_budget' };

  if (taskVenueId(task) === 'okx') {
    const size = numericValue(params.sz || params.size);
    const price = numericValue(params.px || params.price);
    if (size !== null && price !== null) {
      return { status: 'ok', amount: size * price, source: 'price_times_size' };
    }
  }
  if (taskVenueId(task) === 'hyperliquid') {
    const size = numericValue(params.sz || params.size);
    const price = numericValue(params.limitPx || params.price);
    if (size !== null && price !== null) {
      return { status: 'ok', amount: size * price, source: 'price_times_size' };
    }
  }
  return {
    status: 'missing',
    code: 'POLICY_BUDGET_PROOF_REQUIRED',
    message: 'Task needs explicit max_notional_usd/max_quote_amount or price*size budget proof.',
  };
}

function taskInputAmount(task = {}) {
  const constraints = task.constraints || {};
  const params = task.action?.params || {};
  return numericValue(
    constraints.max_input_amount ||
      params.max_input_amount ||
      params.amount ||
      params.raw_amount ||
      params.sz
  );
}

function taskSlippageBps(task = {}) {
  const constraints = task.constraints || {};
  const params = task.action?.params || {};
  return numericValue(constraints.slippage_bps ?? params.slippageBps ?? params.slippage_bps);
}

function blockedGuard(code, message, extra = {}) {
  return {
    status: 'blocked',
    local_decision: 'blocked_by_local_policy_guard',
    code,
    message,
    ...extra,
  };
}

export function evaluateLocalPolicyTaskGuard(policy = {}, task = {}, options = {}) {
  if (!isObject(policy) || !isObject(task)) {
    return blockedGuard(
      'BAD_POLICY_TASK_GUARD_INPUT',
      'Policy guard requires policy and task objects.'
    );
  }

  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : Number.isFinite(Number(options.now))
        ? Number(options.now)
        : Date.parse(options.now || new Date());
  const validation = validateAgentTask(task, {
    allow_planned: true,
    now_ms: nowMs,
  });
  if (validation.status !== 'ok') {
    return blockedGuard(validation.code, validation.message, { validation });
  }

  if (policy.status && policy.status !== 'active') {
    return blockedGuard('POLICY_NOT_ACTIVE', 'Only active policies can be run.');
  }
  if (task.policy_id && policy.policy_id && task.policy_id !== policy.policy_id) {
    return blockedGuard('POLICY_TASK_ID_MISMATCH', 'Task policy_id does not match local policy.', {
      expected_policy_id: policy.policy_id,
      actual_policy_id: task.policy_id,
    });
  }

  const venueId = taskVenueId(task);
  if (!list(policy.target_venue_ids).includes(venueId)) {
    return blockedGuard(
      'POLICY_VENUE_SCOPE_DENIED',
      'Task venue is outside policy target_venue_ids.',
      {
        venue_id: venueId,
        target_venue_ids: policy.target_venue_ids || [],
      }
    );
  }
  if (policy.target_agent && task.target_agent && policy.target_agent !== task.target_agent) {
    return blockedGuard('POLICY_AGENT_SCOPE_DENIED', 'Task target_agent is outside policy scope.', {
      expected_agent: policy.target_agent,
      actual_agent: task.target_agent,
    });
  }

  const supportedActions = SUPPORTED_POLICY_ACTIONS[venueId] || [];
  if (!supportedActions.includes(task.action?.type)) {
    return blockedGuard(
      'POLICY_ACTION_UNSUPPORTED',
      'Task action is not supported by local policy runner.',
      {
        venue_id: venueId,
        action_type: task.action?.type || null,
        supported_actions: supportedActions,
      }
    );
  }
  const allowedActions = list(
    policy.constraints?.allowed_action_types || policy.constraints?.allowed_actions
  );
  if (allowedActions.length && !allowedActions.includes(task.action?.type)) {
    return blockedGuard(
      'POLICY_ACTION_SCOPE_DENIED',
      'Task action is outside policy allowed_action_types.',
      {
        action_type: task.action?.type,
        allowed_action_types: allowedActions,
      }
    );
  }

  const capabilities = taskCapabilities(task);
  const denied = capabilities.filter((capability) => ['withdraw', 'transfer'].includes(capability));
  if (denied.length) {
    return blockedGuard(
      'POLICY_CAPABILITY_DENIED',
      'Policy runner refuses withdrawal/transfer capabilities.',
      {
        denied_capabilities: denied,
      }
    );
  }
  if (task.constraints?.no_withdraw === false) {
    return blockedGuard('POLICY_NO_WITHDRAW_REQUIRED', 'Task must preserve no_withdraw=true.');
  }

  const maxNotional = numericValue(
    policyConstraint(policy, 'max_notional_usd', 'max_quote_amount', 'quote_budget')
  );
  if (maxNotional !== null) {
    const notional = taskNotional(task);
    if (notional.status !== 'ok') return blockedGuard(notional.code, notional.message);
    if (notional.amount > maxNotional) {
      return blockedGuard('POLICY_BUDGET_EXCEEDED', 'Task notional exceeds local policy cap.', {
        task_notional: notional.amount,
        max_notional: maxNotional,
        notional_source: notional.source,
      });
    }
  }

  const maxInput = numericValue(policyConstraint(policy, 'max_input_amount'));
  if (maxInput !== null) {
    const inputAmount = taskInputAmount(task);
    if (inputAmount === null) {
      return blockedGuard(
        'POLICY_INPUT_AMOUNT_REQUIRED',
        'Task input amount is required for max_input_amount guard.'
      );
    }
    if (inputAmount > maxInput) {
      return blockedGuard(
        'POLICY_INPUT_AMOUNT_EXCEEDED',
        'Task input amount exceeds local policy cap.',
        {
          task_input_amount: inputAmount,
          max_input_amount: maxInput,
        }
      );
    }
  }

  const maxSlippageBps = numericValue(policyConstraint(policy, 'max_slippage_bps'));
  if (maxSlippageBps !== null) {
    const slippageBps = taskSlippageBps(task);
    if (slippageBps === null) {
      return blockedGuard(
        'POLICY_SLIPPAGE_REQUIRED',
        'Task slippage is required for max_slippage_bps guard.'
      );
    }
    if (slippageBps > maxSlippageBps) {
      return blockedGuard('POLICY_SLIPPAGE_EXCEEDED', 'Task slippage exceeds local policy cap.', {
        task_slippage_bps: slippageBps,
        max_slippage_bps: maxSlippageBps,
      });
    }
  }

  return {
    status: 'ok',
    local_decision: 'allowed_by_local_policy_guard',
    policy_id: policy.policy_id,
    task_id: task.task_id,
    venue_id: venueId,
    action_type: task.action?.type || null,
  };
}

function resultStatus(results) {
  if (!results.length) return 'ok';
  const okCount = results.filter((result) =>
    ['planned', 'ready', 'dispatched'].includes(result.status)
  ).length;
  const blockedCount = results.filter((result) =>
    ['blocked', 'error'].includes(result.status)
  ).length;
  if (blockedCount && okCount) return 'partial';
  if (blockedCount) return 'blocked';
  return 'ok';
}

function taskResultBase(entry = {}) {
  return {
    policy_id: entry.policy_id,
    target_agent: entry.target_agent || null,
    task_id: entry.task_id,
    venue_id: entry.venue_id,
    action_type: entry.action_type,
    template_index: entry.template_index,
    task: entry.task || null,
  };
}

function policyTickStatus(results, policyId) {
  const scoped = results.filter((result) => result.policy_id === policyId);
  if (!scoped.length) return 'run_once_no_tasks';
  if (scoped.some((result) => result.status === 'dispatched')) return 'run_once_dispatched';
  if (scoped.some((result) => result.status === 'ready')) return 'run_once_ready';
  if (scoped.some((result) => result.status === 'planned')) return 'run_once_planned';
  if (scoped.some((result) => result.status === 'skipped')) return 'run_once_not_triggered';
  return 'run_once_blocked';
}

async function maybeRecordActivity(recordActivity, payload) {
  if (typeof recordActivity !== 'function') return null;
  return recordActivity(payload);
}

async function resolveInventorySnapshot(policy, task, options, now) {
  if (options.inventorySnapshot || options.inventory_snapshot) {
    return options.inventorySnapshot || options.inventory_snapshot;
  }
  if (typeof options.getInventorySnapshot !== 'function') return null;
  return options.getInventorySnapshot({
    policy,
    task,
    scope: [taskVenueId(task)].filter(Boolean),
    live: Boolean(options.liveInventory || options.live_inventory),
    now,
  });
}

async function resolveMarketSnapshot(policy, task, options, now) {
  if (options.marketSnapshot || options.market_snapshot) {
    return options.marketSnapshot || options.market_snapshot;
  }
  if (typeof options.getMarketSnapshot !== 'function') return null;
  return options.getMarketSnapshot({
    policy,
    task,
    scope: [taskVenueId(task)].filter(Boolean),
    now,
  });
}

export async function runDuePolicyTasks(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const dispatch = Boolean(options.dispatch);
  const checkReadiness = Boolean(options.checkReadiness || dispatch);
  const checkInventory = Boolean(options.checkInventory || options.check_inventory);
  const policyStore = options.policyStore || {};
  const policies = Array.isArray(policyStore.policies) ? policyStore.policies : [];
  const policyById = new Map(policies.map((policy) => [policy.policy_id, policy]));
  const plan = buildDuePolicyTaskPlan({
    policyStore,
    secretStore: options.secretStore,
    now,
    limit: Number(options.limit || 50),
    simulated: options.simulated !== false,
  });

  const results = [
    ...plan.blocked_tasks.map((blocked) => ({
      ...blocked,
      status: 'blocked',
      local_decision: 'blocked_before_local_policy_guard',
      task: null,
    })),
  ];

  for (const entry of plan.planned_tasks) {
    const policy = policyById.get(entry.policy_id);
    const guard = evaluateLocalPolicyTaskGuard(policy, entry.task, { now });
    if (guard.status !== 'ok') {
      const blocked = {
        ...taskResultBase(entry),
        status: 'blocked',
        local_decision: guard.local_decision,
        code: guard.code,
        message: guard.message,
        guard,
      };
      results.push(blocked);
      await maybeRecordActivity(options.recordActivity, {
        type: 'policy.local.run_once.blocked',
        task: entry.task,
        status: 'error',
        code: guard.code,
        message: guard.message,
        local_decision: guard.local_decision,
      });
      continue;
    }

    const shouldRunInventoryGuard =
      (checkReadiness || checkInventory || dispatch) && localPolicyRiskGuardRequired(policy);
    const shouldRunTriggerGuard =
      (checkReadiness ||
        checkInventory ||
        dispatch ||
        options.checkTriggers ||
        options.check_triggers) &&
      localPolicyTriggerGuardRequired(policy);
    let triggerGuard = {
      status: 'skipped',
      local_decision: 'trigger_guard_not_requested',
    };
    if (shouldRunTriggerGuard) {
      const marketSnapshot = await resolveMarketSnapshot(policy, entry.task, options, now);
      triggerGuard = evaluateLocalPolicyTriggerGuard(policy, entry.task, {
        marketSnapshot,
        now,
      });
      if (triggerGuard.status === 'skipped') {
        results.push({
          ...taskResultBase(entry),
          status: 'skipped',
          local_decision: triggerGuard.local_decision,
          code: triggerGuard.code || null,
          message: triggerGuard.message || null,
          guard,
          market_trigger: triggerGuard,
        });
        await maybeRecordActivity(options.recordActivity, {
          type: 'policy.local.run_once.noop',
          task: entry.task,
          status: 'skipped',
          code: triggerGuard.code || null,
          message: triggerGuard.message || null,
          local_decision: triggerGuard.local_decision,
        });
        continue;
      }
      if (triggerGuard.status !== 'ok') {
        const blocked = {
          ...taskResultBase(entry),
          status: 'blocked',
          local_decision: triggerGuard.local_decision,
          code: triggerGuard.code,
          message: triggerGuard.message,
          guard,
          market_trigger: triggerGuard,
        };
        results.push(blocked);
        await maybeRecordActivity(options.recordActivity, {
          type: 'policy.local.run_once.blocked',
          task: entry.task,
          status: 'error',
          code: triggerGuard.code,
          message: triggerGuard.message,
          local_decision: triggerGuard.local_decision,
          marketTrigger: triggerGuard,
        });
        continue;
      }
    }
    let inventoryGuard = {
      status: 'skipped',
      local_decision: 'inventory_guard_not_requested',
    };
    if (shouldRunInventoryGuard) {
      const inventorySnapshot = await resolveInventorySnapshot(policy, entry.task, options, now);
      inventoryGuard = evaluateLocalPolicyRiskGuard(policy, entry.task, {
        inventorySnapshot,
        now,
      });
      if (inventoryGuard.status !== 'ok' && inventoryGuard.status !== 'skipped') {
        const blocked = {
          ...taskResultBase(entry),
          status: 'blocked',
          local_decision: inventoryGuard.local_decision,
          code: inventoryGuard.code,
          message: inventoryGuard.message,
          guard,
          market_trigger: triggerGuard,
          inventory_guard: inventoryGuard,
        };
        results.push(blocked);
        await maybeRecordActivity(options.recordActivity, {
          type: 'policy.local.run_once.blocked',
          task: entry.task,
          status: 'error',
          code: inventoryGuard.code,
          message: inventoryGuard.message,
          local_decision: inventoryGuard.local_decision,
          inventoryGuard,
        });
        continue;
      }
    }

    if (!checkReadiness) {
      results.push({
        ...taskResultBase(entry),
        status: 'planned',
        local_decision: 'planned_no_dispatch',
        guard,
        market_trigger: triggerGuard,
        inventory_guard: inventoryGuard,
      });
      continue;
    }

    const commandResolution = dispatch
      ? resolveAgentDispatchCommand({
          payload: { task: entry.task, target_agent: entry.target_agent },
          registry: options.agentRegistry,
          defaultAgentCommand: options.defaultAgentCommand || '',
        })
      : { status: 'ok', command: null };
    if (commandResolution.status !== 'ok') {
      const blocked = {
        ...taskResultBase(entry),
        status: 'blocked',
        local_decision: 'blocked_before_dispatch',
        code: commandResolution.code,
        message: commandResolution.message,
        guard,
        market_trigger: triggerGuard,
        inventory_guard: inventoryGuard,
        task_capability: commandResolution.task_capability || null,
      };
      results.push(blocked);
      await maybeRecordActivity(options.recordActivity, {
        type: 'policy.local.run_once.blocked',
        task: entry.task,
        status: 'error',
        code: commandResolution.code,
        message: commandResolution.message,
        local_decision: 'blocked_before_dispatch',
      });
      continue;
    }

    const readiness = await (options.getReadiness || getLocalDispatchReadiness)({
      task: entry.task,
      secretStore: options.secretStore,
      walletStore: options.walletStore,
      verifyHyperliquidLiveGrant: options.verifyHyperliquidLiveGrant === true,
      verifyOkxLiveRead: options.verifyOkxLiveRead === true,
      requireSignerProbe: Boolean(options.requireSignerProbe),
      signerProbeTimeoutMs: Number(options.signerProbeTimeoutMs || 3000),
      env: options.env || process.env,
      fetchImpl: options.fetchImpl || fetch,
      now,
    });
    if (readiness.status === 'error') {
      const blocked = {
        ...taskResultBase(entry),
        status: 'blocked',
        local_decision: readiness.local_decision || 'blocked_before_dispatch',
        code: readiness.code,
        message: readiness.message,
        guard,
        market_trigger: triggerGuard,
        inventory_guard: inventoryGuard,
        local_dispatch_readiness: readiness,
      };
      results.push(blocked);
      await maybeRecordActivity(options.recordActivity, {
        type: 'policy.local.run_once.blocked',
        task: entry.task,
        dispatch: readiness,
        localDispatchReadiness: readiness,
      });
      continue;
    }

    if (!dispatch) {
      results.push({
        ...taskResultBase(entry),
        status: 'ready',
        local_decision: 'ready_no_dispatch',
        guard,
        market_trigger: triggerGuard,
        inventory_guard: inventoryGuard,
        local_dispatch_readiness: readiness,
      });
      continue;
    }

    const dispatched = await (options.dispatchTask || dispatchAgentTask)({
      task: entry.task,
      commandLine: commandResolution.command,
      timeoutMs: Number(options.timeoutMs || 30_000),
      allowPlanned: false,
      localDispatchReadyVenues: readiness.ready_venue_ids || [],
    });
    const verified =
      options.verifyReceipt === false
        ? {
            status: 'ok',
            dispatch: dispatched,
            receipt_verification: { status: 'skipped', reason: 'disabled_by_policy_run_once' },
          }
        : await (options.verifyReceiptFn || verifyDispatchReceipt)({
            task: entry.task,
            dispatch: dispatched,
            secretStore: options.secretStore,
            simulated: Boolean(options.simulated),
            hyperliquidNonceStorePath: options.hyperliquidNonceStorePath,
            verifyHyperliquidLiveGrant: options.verifyHyperliquidLiveGrant === true,
            solanaSignerCommand: options.solanaSignerCommand,
            ethereumSignerCommand: options.ethereumSignerCommand,
            signerCommand: options.signerCommand,
            signerTimeoutMs: Number(options.signerTimeoutMs || options.timeoutMs || 30_000),
            ...(options.signerSpawnImpl ? { signerSpawnImpl: options.signerSpawnImpl } : {}),
            env: options.env || process.env,
            fetchImpl: options.fetchImpl || fetch,
            now,
          });
    const finalDispatch =
      verified.status === 'ok'
        ? {
            ...verified.dispatch,
            receipt_verification: verified.receipt_verification,
            local_dispatch_readiness: readiness,
          }
        : {
            ...verified.dispatch,
            status: 'error',
            code: verified.code,
            message: verified.message,
            local_decision: verified.local_decision,
            receipt_verification: verified.receipt_verification,
            local_dispatch_readiness: readiness,
          };
    const finalStatus = finalDispatch.status === 'ok' ? 'dispatched' : 'error';
    results.push({
      ...taskResultBase(entry),
      status: finalStatus,
      local_decision: finalDispatch.local_decision,
      code: finalDispatch.code || null,
      message: finalDispatch.message || null,
      guard,
      market_trigger: triggerGuard,
      inventory_guard: inventoryGuard,
      local_dispatch_readiness: readiness,
      dispatch: finalDispatch,
      registered_agent: commandResolution.agent_id
        ? {
            agent_id: commandResolution.agent_id,
            capabilities: commandResolution.capabilities,
            task_capabilities: commandResolution.task_capabilities,
            task_capability: commandResolution.task_capability,
          }
        : null,
      unregistered_command: Boolean(commandResolution.unregistered_command),
    });
    await maybeRecordActivity(options.recordActivity, {
      type: 'policy.local.run_once',
      task: entry.task,
      dispatch: finalDispatch,
      localDispatchReadiness: readiness,
      inventoryGuard,
      marketTrigger: triggerGuard,
      receiptVerification: finalDispatch.receipt_verification,
      registeredAgent: commandResolution.agent_id
        ? {
            agent_id: commandResolution.agent_id,
            capabilities: commandResolution.capabilities,
            task_capabilities: commandResolution.task_capabilities,
            task_capability: commandResolution.task_capability,
          }
        : null,
    });
  }

  const marks = [];
  if (options.markTicks) {
    const duePolicyIds = [...new Set(plan.due_policies.map((policy) => policy.policy_id))];
    for (const policyId of duePolicyIds) {
      marks.push(
        await (options.markPolicyTick || markLocalPolicyTick)(
          { policy_id: policyId, status: policyTickStatus(results, policyId) },
          { configPath: options.policyStorePath, now: plan.observed_at }
        )
      );
    }
  }

  return {
    status: resultStatus(results),
    mode: dispatch ? 'dispatch' : checkReadiness ? 'readiness' : 'plan',
    observed_at: plan.observed_at,
    metadata_path: plan.metadata_path || policyStore.metadata_path || null,
    store_status: plan.store_status || policyStore.status || null,
    due_count: plan.due_count,
    selected_count: plan.selected_count,
    planned_task_count: plan.planned_task_count,
    result_count: results.length,
    ready_task_count: results.filter((result) => result.status === 'ready').length,
    dispatched_task_count: results.filter((result) => result.status === 'dispatched').length,
    skipped_task_count: results.filter((result) => result.status === 'skipped').length,
    blocked_task_count: results.filter((result) => ['blocked', 'error'].includes(result.status))
      .length,
    results,
    marked: marks,
  };
}
