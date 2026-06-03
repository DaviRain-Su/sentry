import { createHash } from 'node:crypto';
import { validateAgentTask, RAW_AGENT_SECRET_FIELDS } from '../../core/agent-task.js';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import { buildOkxPlaceOrderTask } from '../../core/okx-trade.js';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';
import { buildLocalPolicyTickSnapshot } from './local-policy-store.mjs';

const CHAIN_SWAP_VENUES = ['solana-mainnet', 'ethereum-mainnet'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function secretFieldPath(value, prefix = '') {
  if (!isObject(value) && !Array.isArray(value)) return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && RAW_AGENT_SECRET_FIELDS.includes(key)) return path;
    const nested = secretFieldPath(child, path);
    if (nested) return nested;
  }
  return null;
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeVenueId(value) {
  const text = normalizeString(value).toLowerCase();
  if (text === 'solana') return 'solana-mainnet';
  if (text === 'ethereum' || text === 'evm') return 'ethereum-mainnet';
  return text;
}

function normalizeActionType(template = {}) {
  const text = normalizeString(
    template.action_type || template.actionType || template.action?.type || template.type
  ).toLowerCase();
  if (text === 'order') return 'place_order';
  if (text === 'swap') return 'swap';
  if (text === 'submit_tx' && CHAIN_SWAP_VENUES.includes(normalizeVenueId(template.venue_id))) {
    return 'swap';
  }
  return text;
}

function templateParams(template = {}) {
  return {
    ...(isObject(template.action?.params) ? template.action.params : {}),
    ...template,
  };
}

function getTemplateVenueId(policy = {}, template = {}) {
  const explicit = normalizeVenueId(
    template.venue_id || template.venue || template.target_venue_id || template.targetVenueId
  );
  if (explicit) return explicit;
  return policy.target_venue_ids?.length === 1 ? policy.target_venue_ids[0] : '';
}

function taskTemplatesFor(policy = {}) {
  const templates = [];
  if (isObject(policy.task_template)) templates.push(policy.task_template);
  if (Array.isArray(policy.task_templates)) templates.push(...policy.task_templates);
  if (Array.isArray(policy.planned_tasks)) templates.push(...policy.planned_tasks);
  if (isObject(policy.strategy?.task_template)) templates.push(policy.strategy.task_template);
  if (Array.isArray(policy.strategy?.task_templates))
    templates.push(...policy.strategy.task_templates);
  if (Array.isArray(policy.strategy?.planned_tasks))
    templates.push(...policy.strategy.planned_tasks);
  return templates.filter(isObject);
}

function digestHex(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeIdPart(value) {
  return normalizeString(value)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function stableTaskSeed(policy, template, index, nowIso) {
  return {
    policy_id: policy.policy_id,
    target_agent: policy.target_agent || null,
    template,
    index,
    nowIso,
  };
}

function stableTaskId(policy, venueId, template, index, nowIso) {
  const digest = digestHex(stableTaskSeed(policy, template, index, nowIso)).slice(0, 16);
  return `task_${safeIdPart(venueId)}_${safeIdPart(policy.policy_id)}_${index}_${digest}`;
}

function stableOkxClientOrderId(policy, template, index, nowIso) {
  return `sentry-${digestHex(stableTaskSeed(policy, template, index, nowIso)).slice(0, 24)}`;
}

function stableHyperliquidCloid(policy, template, index, nowIso) {
  return `0x${digestHex(stableTaskSeed(policy, template, index, nowIso)).slice(0, 32)}`;
}

function stableQuoteId(venueId, policy, template, index, nowIso) {
  return `${venueId === 'solana-mainnet' ? 'solana' : 'ethereum'}-${digestHex(
    stableTaskSeed(policy, template, index, nowIso)
  ).slice(0, 20)}`;
}

function blockedTask(policy, template, index, code, message, extra = {}) {
  return {
    status: 'blocked',
    policy_id: policy?.policy_id || null,
    target_agent: policy?.target_agent || null,
    template_index: index,
    venue_id: extra.venue_id || null,
    action_type: extra.action_type || null,
    code,
    message,
    ...extra,
  };
}

function keySelector(template = {}) {
  return normalizeString(
    template.key_handle ||
      template.keyHandle ||
      template.authorization_ref ||
      template.authorizationRef ||
      template.account_ref ||
      template.accountRef ||
      template.read_account_address ||
      template.readAccountAddress ||
      template.agent_wallet_address ||
      template.agentWalletAddress
  );
}

function findVenueKeyMetadata(secretStore = {}, venueId, template = {}) {
  const candidates = (secretStore.keys || []).filter((key) => key.venue_id === venueId);
  const selector = keySelector(template);
  if (selector) {
    const key = candidates.find((candidate) =>
      [
        candidate.key_handle,
        candidate.display_handle,
        candidate.account_ref,
        candidate.read_account_address,
        candidate.agent_wallet_address,
      ]
        .filter(Boolean)
        .includes(selector)
    );
    if (key) return { status: 'ok', key };
    return {
      status: 'blocked',
      code: venueId === 'okx' ? 'OKX_KEY_METADATA_REQUIRED' : 'HYPERLIQUID_KEY_METADATA_REQUIRED',
      message: `No ${venueId} key metadata matched the policy template selector.`,
    };
  }
  if (candidates.length === 1) return { status: 'ok', key: candidates[0] };
  return {
    status: 'blocked',
    code: venueId === 'okx' ? 'OKX_KEY_HANDLE_REQUIRED' : 'HYPERLIQUID_KEY_HANDLE_REQUIRED',
    message: `${venueId} policy templates must reference a key_handle when zero or multiple local keys exist.`,
  };
}

function buildAndValidate(builder, builderInput) {
  const built = builder(builderInput);
  if (built.status !== 'ok') return built;
  const validation = validateAgentTask(built.task, {
    allow_planned: true,
    now_ms: Number(builderInput.nowMs || builderInput.now_ms || Date.now()),
  });
  if (validation.status !== 'ok') return validation;
  return { status: 'ok', task: built.task };
}

function planTemplate(policy, template, index, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const rawSecretPath = secretFieldPath(template);
  if (rawSecretPath) {
    return blockedTask(
      policy,
      template,
      index,
      'RAW_SECRET_REJECTED',
      `Policy task template must not include raw secret field: ${rawSecretPath}`,
      { path: rawSecretPath }
    );
  }

  const params = templateParams(template);
  const venueId = getTemplateVenueId(policy, params);
  const actionType = normalizeActionType(params);
  const targetVenueIds = policy.target_venue_ids || [];

  if (!venueId) {
    return blockedTask(
      policy,
      template,
      index,
      'POLICY_TEMPLATE_VENUE_REQUIRED',
      'Policy task template requires venue_id.',
      {
        action_type: actionType || null,
      }
    );
  }
  if (!targetVenueIds.includes(venueId)) {
    return blockedTask(
      policy,
      template,
      index,
      'POLICY_TEMPLATE_VENUE_OUT_OF_SCOPE',
      'Policy task template venue_id is outside target_venue_ids.',
      { venue_id: venueId, action_type: actionType || null, target_venue_ids: targetVenueIds }
    );
  }
  if (!actionType) {
    return blockedTask(
      policy,
      template,
      index,
      'POLICY_TEMPLATE_ACTION_REQUIRED',
      'Policy task template requires action_type.',
      {
        venue_id: venueId,
      }
    );
  }

  const taskId =
    params.taskId || params.task_id || stableTaskId(policy, venueId, params, index, nowIso);
  const baseInput = {
    ...params,
    policyId: policy.policy_id,
    policy_id: policy.policy_id,
    targetAgent: params.targetAgent || params.target_agent || policy.target_agent,
    target_agent: params.target_agent || params.targetAgent || policy.target_agent,
    taskId,
    task_id: taskId,
    nowMs,
    now_ms: nowMs,
    simulated: params.simulated ?? options.simulated ?? true,
  };

  let built;
  if (venueId === 'okx') {
    if (actionType !== 'place_order') {
      return blockedTask(
        policy,
        template,
        index,
        'OKX_ACTION_UNSUPPORTED',
        'OKX planner only supports place_order templates.',
        {
          venue_id: venueId,
          action_type: actionType,
        }
      );
    }
    const key = findVenueKeyMetadata(options.secretStore, venueId, params);
    if (key.status !== 'ok') {
      return blockedTask(policy, template, index, key.code, key.message, {
        venue_id: venueId,
        action_type: actionType,
      });
    }
    built = buildAndValidate(buildOkxPlaceOrderTask, {
      ...baseInput,
      keyMetadata: key.key,
      key_metadata: key.key,
      clientOrderId:
        params.clientOrderId ||
        params.client_order_id ||
        params.clOrdId ||
        params.cl_ord_id ||
        stableOkxClientOrderId(policy, params, index, nowIso),
    });
  } else if (venueId === 'hyperliquid') {
    if (actionType !== 'place_order') {
      return blockedTask(
        policy,
        template,
        index,
        'HYPERLIQUID_ACTION_UNSUPPORTED',
        'Hyperliquid planner only supports place_order templates.',
        { venue_id: venueId, action_type: actionType }
      );
    }
    const key = findVenueKeyMetadata(options.secretStore, venueId, params);
    if (key.status !== 'ok') {
      return blockedTask(policy, template, index, key.code, key.message, {
        venue_id: venueId,
        action_type: actionType,
      });
    }
    built = buildAndValidate(buildHyperliquidPlaceOrderTask, {
      ...baseInput,
      keyMetadata: key.key,
      key_metadata: key.key,
      cloid:
        params.cloid ||
        params.clientOrderId ||
        params.client_order_id ||
        stableHyperliquidCloid(policy, params, index, nowIso),
    });
  } else if (venueId === 'solana-mainnet') {
    if (actionType !== 'swap') {
      return blockedTask(
        policy,
        template,
        index,
        'SOLANA_ACTION_UNSUPPORTED',
        'Solana planner only supports swap templates.',
        { venue_id: venueId, action_type: actionType }
      );
    }
    built = buildAndValidate(buildSolanaSwapTask, {
      ...baseInput,
      quoteId:
        params.quoteId || params.quote_id || stableQuoteId(venueId, policy, params, index, nowIso),
    });
  } else if (venueId === 'ethereum-mainnet') {
    if (actionType !== 'swap') {
      return blockedTask(
        policy,
        template,
        index,
        'ETHEREUM_ACTION_UNSUPPORTED',
        'Ethereum planner only supports swap templates.',
        { venue_id: venueId, action_type: actionType }
      );
    }
    built = buildAndValidate(buildEthereumSwapTask, {
      ...baseInput,
      quoteId:
        params.quoteId || params.quote_id || stableQuoteId(venueId, policy, params, index, nowIso),
    });
  } else {
    return blockedTask(
      policy,
      template,
      index,
      'POLICY_TEMPLATE_VENUE_UNSUPPORTED',
      'Policy task template targets an unsupported venue.',
      {
        venue_id: venueId,
        action_type: actionType,
      }
    );
  }

  if (built.status !== 'ok') {
    return blockedTask(
      policy,
      template,
      index,
      built.code || 'AGENT_TASK_BUILD_FAILED',
      built.message || 'AgentTask construction failed.',
      {
        venue_id: venueId,
        action_type: actionType,
        issues: built.issues || null,
      }
    );
  }

  return {
    status: 'ok',
    policy_id: policy.policy_id,
    target_agent: built.task.target_agent || policy.target_agent || null,
    template_index: index,
    venue_id: venueId,
    action_type: actionType,
    task_id: built.task.task_id,
    task: built.task,
  };
}

export function buildPolicyTaskPlan(policy = {}, options = {}) {
  if (!isObject(policy)) {
    return {
      status: 'blocked',
      policy_id: null,
      planned_tasks: [],
      blocked_tasks: [
        blockedTask(
          null,
          null,
          0,
          'BAD_LOCAL_POLICY',
          'Policy task planning requires a policy object.'
        ),
      ],
    };
  }
  if (policy.status && policy.status !== 'active') {
    return {
      status: 'blocked',
      policy_id: policy.policy_id || null,
      planned_tasks: [],
      blocked_tasks: [
        blockedTask(policy, null, 0, 'POLICY_NOT_ACTIVE', 'Only active policies can be planned.'),
      ],
    };
  }
  const templates = taskTemplatesFor(policy);
  if (!templates.length) {
    return {
      status: 'blocked',
      policy_id: policy.policy_id || null,
      planned_tasks: [],
      blocked_tasks: [
        blockedTask(
          policy,
          null,
          0,
          'POLICY_TASK_TEMPLATE_REQUIRED',
          'Policy is due but has no explicit task_template/task_templates/planned_tasks entry.'
        ),
      ],
    };
  }

  const results = templates.map((template, index) =>
    planTemplate(policy, template, index, options)
  );
  const plannedTasks = results.filter((result) => result.status === 'ok');
  const blockedTasks = results.filter((result) => result.status !== 'ok');
  return {
    status: blockedTasks.length ? (plannedTasks.length ? 'partial' : 'blocked') : 'ok',
    policy_id: policy.policy_id || null,
    planned_task_count: plannedTasks.length,
    blocked_task_count: blockedTasks.length,
    planned_tasks: plannedTasks,
    blocked_tasks: blockedTasks,
  };
}

export function buildDuePolicyTaskPlan(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const policyStore = options.policyStore || {};
  const policies = Array.isArray(options.policies)
    ? options.policies
    : Array.isArray(policyStore.policies)
      ? policyStore.policies
      : [];
  const tick = buildLocalPolicyTickSnapshot({
    policies,
    now,
    limit: Number(options.limit || 50),
  });
  const policyById = new Map(policies.map((policy) => [policy.policy_id, policy]));
  const policyPlans = tick.due_policies.map((duePolicy) =>
    buildPolicyTaskPlan(policyById.get(duePolicy.policy_id) || duePolicy, {
      ...options,
      now: tick.observed_at,
    })
  );
  const plannedTasks = policyPlans.flatMap((plan) => plan.planned_tasks);
  const blockedTasks = policyPlans.flatMap((plan) => plan.blocked_tasks);
  const blockedPolicyIds = [...new Set(blockedTasks.map((task) => task.policy_id).filter(Boolean))];

  return {
    ...tick,
    status: blockedTasks.length ? (plannedTasks.length ? 'partial' : 'blocked') : 'ok',
    store_status: policyStore.status || null,
    metadata_path: policyStore.metadata_path || null,
    planned_task_count: plannedTasks.length,
    blocked_task_count: blockedTasks.length,
    blocked_policy_count: blockedPolicyIds.length,
    planned_tasks: plannedTasks,
    blocked_tasks: blockedTasks,
    blocked_policies: blockedPolicyIds.map((policyId) => ({
      policy_id: policyId,
      blocked_task_count: blockedTasks.filter((task) => task.policy_id === policyId).length,
    })),
  };
}
